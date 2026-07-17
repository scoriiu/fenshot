/**
 * Synthetic training corpus generator for the tile classifier.
 *
 *   npx tsx tools/tile-classifier/generate-corpus.ts --boards 8000
 *
 * Renders chessboard screenshots across every downloaded piece set and
 * board texture (download-assets.ts), applies the degradations real
 * screenshots suffer (dimming overlays, JPEG artifacts, blur, resize
 * round-trips, highlights, arrows, coordinate labels), then extracts
 * 32x32 grayscale tiles through THE EXACT same pipeline the app uses
 * (rgbaToGray + extractBoardImage + boardToTiles) so there is zero
 * train/serve skew. Labels are free: we rendered the position.
 *
 * Output shards in .tmp/scan-corpus/:
 *   shard-NNN.bin     concatenated u8 tiles, 64*1024 bytes per board
 *   shard-NNN.labels  one 64-char line per board, tile order (A1..H8)
 *   meta.json         per-board theme info for held-out splits
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import { Chess } from "chess.js";
import { rgbaToGray, extractBoardImage, boardToTiles } from "@scoriiu/fenshot";

const ASSETS = ".tmp/scan-assets";
const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 ? process.argv[outArg + 1] : ".tmp/scan-corpus";
const SHARD_SIZE = 250;
const LABELS = "1KQRBNPkqrbnp";
const PIECE_CODES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

/** Deterministic RNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Theme {
  pieceSet: string;
  pieceDir: string;
  pieceExt: string;
  board: string;
  boardPath: string | Buffer;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** Flat two-color board with random colors: covers any site's custom theme. */
function proceduralFlatBoard(rand: () => number): Buffer {
  const hue = rand() * 360;
  const sameHue = rand() < 0.5;
  const light = hsl(sameHue ? hue : rand() * 360, 5 + rand() * 55, 72 + rand() * 24);
  const dark = hsl(hue, 10 + rand() * 60, 30 + rand() * 35);
  const t = 64;
  const rects: string[] = [`<rect width="512" height="512" fill="${light}"/>`];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++)
      if ((r + f) % 2 === 1) rects.push(`<rect x="${f * t}" y="${r * t}" width="${t}" height="${t}" fill="${dark}"/>`);
  return Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`);
}

/** Book/print diagram board: white squares, diagonally hatched dark squares. */
function proceduralHatchBoard(rand: () => number): Buffer {
  const t = 64;
  const lineW = 1 + rand() * 2;
  const gap = 5 + rand() * 6;
  const ink = rand() < 0.8 ? "#000000" : "#333355";
  const pattern = `<pattern id="h" width="${gap}" height="${gap}" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="${gap}" height="${gap}" fill="#ffffff"/><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${ink}" stroke-width="${lineW}"/></pattern>`;
  const rects: string[] = [`<rect width="512" height="512" fill="#ffffff"/>`];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++)
      if ((r + f) % 2 === 1) rects.push(`<rect x="${f * t}" y="${r * t}" width="${t}" height="${t}" fill="url(#h)"/>`);
  return Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><defs>${pattern}</defs>${rects.join("")}</svg>`);
}

const PRINT_SETS = ["lichess-alpha", "lichess-cburnett", "lichess-merida", "lichess-leipzig", "lichess-chess7", "lichess-companion", "lichess-fantasy"];

async function loadThemes(): Promise<{ pieceSets: { name: string; dir: string; ext: string }[]; boards: { name: string; path: string }[] }> {
  const pieceSets = [];
  for (const name of await readdir(join(ASSETS, "pieces"))) {
    const dir = join(ASSETS, "pieces", name);
    const files = await readdir(dir);
    if (files.length === 12) {
      pieceSets.push({ name, dir, ext: files[0].endsWith(".svg") ? ".svg" : ".png" });
    }
  }
  const boards = [];
  for (const sub of ["lichess", "chesscom"]) {
    for (const f of await readdir(join(ASSETS, "boards", sub))) {
      boards.push({ name: `${sub}-${f}`, path: join(ASSETS, "boards", sub, f) });
    }
  }
  return { pieceSets, boards };
}

/** names[i] = piece char for tile i (rank*8+file, A1 bottom-left). */
function samplePosition(rand: () => number): string[] {
  const names = new Array<string>(64).fill("1");
  if (rand() < 0.5) {
    const chess = new Chess();
    const depth = Math.floor(rand() * 80);
    for (let i = 0; i < depth; i++) {
      const moves = chess.moves();
      if (moves.length === 0) break;
      chess.move(moves[Math.floor(rand() * moves.length)]);
    }
    chess.board().forEach((row, r) => {
      row.forEach((sq, f) => {
        if (sq) names[(7 - r) * 8 + f] = sq.color === "w" ? sq.type.toUpperCase() : sq.type;
      });
    });
  } else {
    for (let i = 0; i < 64; i++) {
      if (rand() < 0.45) names[i] = LABELS[1 + Math.floor(rand() * 12)];
    }
  }
  return names;
}

const baseCache = new Map<string, Buffer>();
const sizedCache = new Map<string, Buffer>();

/** Two-level cache: rasterize once at 256px per (set, code), resize from there. */
async function pieceImage(theme: Theme, code: string, px: number): Promise<Buffer> {
  const sizedKey = `${theme.pieceDir}/${code}@${px}`;
  const sized = sizedCache.get(sizedKey);
  if (sized) return sized;

  const baseKey = `${theme.pieceDir}/${code}`;
  let base = baseCache.get(baseKey);
  if (!base) {
    const src = join(theme.pieceDir, `${code}${theme.pieceExt}`);
    const opts = { fit: "contain" as const, background: { r: 0, g: 0, b: 0, alpha: 0 } };
    if (theme.pieceExt === ".svg") {
      const raw = await readFile(src);
      const nativeWidth = (await sharp(raw).metadata()).width || 45;
      const density = Math.max(1, Math.min(2400, (72 * 256) / nativeWidth));
      base = await sharp(raw, { density }).resize(256, 256, opts).png().toBuffer();
    } else {
      base = await sharp(src).resize(256, 256, opts).png().toBuffer();
    }
    baseCache.set(baseKey, base);
  }
  const buf = await sharp(base).resize(px, px).png().toBuffer();
  sizedCache.set(sizedKey, buf);
  if (sizedCache.size > 4000) sizedCache.clear();
  return buf;
}

function svgRect(x: number, y: number, s: number, color: string, alpha: number): string {
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}" fill-opacity="${alpha}"/>`;
}

/** Arrow with a real triangular head, like lichess/chess.com renderers. */
function svgArrow(x1: number, y1: number, x2: number, y2: number, w: number, color: string, opacity: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const headLen = w * 2.2;
  const headW = w * 1.8;
  const bx = x2 - headLen * Math.cos(ang);
  const by = y2 - headLen * Math.sin(ang);
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const head = `${x2},${y2} ${bx + px * headW},${by + py * headW} ${bx - px * headW},${by - py * headW}`;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${w}" stroke-opacity="${opacity}" stroke-linecap="round"/>` +
    `<polygon points="${head}" fill="${color}" fill-opacity="${opacity}"/>`
  );
}

/** Decoration overlay: highlights, arrows, coordinate labels. */
function decorationsSvg(size: number, tile: number, rand: () => number): string {
  const parts: string[] = [];
  const highlightColors = ["#f6f669", "#baca44", "#90e0ef", "#fad02c"];
  if (rand() < 0.5) {
    const color = highlightColors[Math.floor(rand() * highlightColors.length)];
    for (let i = 0; i < 2; i++) {
      const f = Math.floor(rand() * 8);
      const r = Math.floor(rand() * 8);
      parts.push(svgRect(f * tile, r * tile, tile, color, 0.3 + rand() * 0.25));
    }
  }
  const arrowColors = ["#ffaa00", "#15781B", "#882020", "#003088", "#888888", "#aaaaaa", "#666666", "#f6f669"];
  const nArrows = rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0;
  for (let i = 0; i < nArrows; i++) {
    const f1 = Math.floor(rand() * 8);
    const r1 = Math.floor(rand() * 8);
    const f2 = Math.floor(rand() * 8);
    const r2 = Math.floor(rand() * 8);
    if (f1 === f2 && r1 === r2) continue;
    parts.push(
      svgArrow(
        (f1 + 0.5) * tile,
        (r1 + 0.5) * tile,
        (f2 + 0.5) * tile,
        (r2 + 0.5) * tile,
        tile * (0.12 + rand() * 0.28),
        arrowColors[Math.floor(rand() * arrowColors.length)],
        0.5 + rand() * 0.45,
      ),
    );
  }
  if (rand() < 0.15) {
    const f = Math.floor(rand() * 8);
    const r = Math.floor(rand() * 8);
    const color = arrowColors[Math.floor(rand() * arrowColors.length)];
    parts.push(
      `<circle cx="${(f + 0.5) * tile}" cy="${(r + 0.5) * tile}" r="${tile * 0.42}" fill="none" stroke="${color}" stroke-width="${tile * 0.07}" stroke-opacity="${0.6 + rand() * 0.35}"/>`,
    );
  }
  if (rand() < 0.15) {
    for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) {
      const f = Math.floor(rand() * 8);
      const r = Math.floor(rand() * 8);
      parts.push(
        `<circle cx="${(f + 0.5) * tile}" cy="${(r + 0.5) * tile}" r="${tile * 0.17}" fill="#000000" fill-opacity="${0.1 + rand() * 0.2}"/>`,
      );
    }
  }
  if (rand() < 0.6) {
    const fontSize = Math.max(8, tile * 0.22);
    const flipped = rand() < 0.5;
    for (let i = 0; i < 8; i++) {
      const fileChar = String.fromCharCode(97 + (flipped ? 7 - i : i));
      const rankChar = String(flipped ? i + 1 : 8 - i);
      const light = rand() < 0.5 ? "#b58863" : "#779556";
      const dark = "#f0d9b5";
      parts.push(
        `<text x="${(i + 1) * tile - fontSize * 0.35}" y="${size - tile * 0.08}" font-size="${fontSize}" font-family="Arial" fill="${i % 2 === 0 ? light : dark}">${fileChar}</text>`,
        `<text x="${tile * 0.06}" y="${i * tile + fontSize * 1.1}" font-size="${fontSize}" font-family="Arial" fill="${i % 2 === 0 ? dark : light}">${rankChar}</text>`,
      );
    }
  }
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

async function renderBoard(theme: Theme, names: string[], size: number, rand: () => number): Promise<Buffer> {
  const tile = size / 8;
  const piecePx = 4 * Math.round((tile * (0.92 + rand() * 0.08)) / 4);
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < 64; i++) {
    if (names[i] === "1") continue;
    const rank = Math.floor(i / 8);
    const file = i % 8;
    const code = PIECE_CODES[(names[i] === names[i].toUpperCase() ? 0 : 6) + "KQRBNP".indexOf(names[i].toUpperCase())];
    const img = await pieceImage(theme, code, piecePx);
    const pad = Math.round((tile - piecePx) / 2);
    composites.push({
      input: img,
      left: Math.round(file * tile) + pad,
      top: Math.round((7 - rank) * tile) + pad,
    });
  }
  composites.push({ input: Buffer.from(decorationsSvg(size, tile, rand)), left: 0, top: 0 });
  return sharp(theme.boardPath)
    .resize(size, size)
    .composite(composites)
    .png()
    .toBuffer();
}

/** Real-screenshot degradations: dimming, jpeg, blur, resize round-trip. */
async function degrade(board: Buffer, size: number, rand: () => number): Promise<Buffer> {
  let img = sharp(board);
  const dimmed = rand() < 0.35;
  const brightness = dimmed ? 0.45 + rand() * 0.3 : 0.85 + rand() * 0.2;
  img = img.modulate({ brightness, saturation: 0.65 + rand() * 0.4 });
  if (rand() < 0.2) img = img.blur(0.3 + rand() * 0.5);
  if (rand() < 0.25) {
    const mid = Math.round(size * (0.55 + rand() * 0.35));
    img = sharp(await img.resize(mid, mid).toBuffer()).resize(size, size);
  }
  if (rand() < 0.8) {
    return sharp(await img.jpeg({ quality: 35 + Math.floor(rand() * 60) }).toBuffer()).ensureAlpha().raw().toBuffer();
  }
  return img.ensureAlpha().raw().toBuffer();
}

async function main() {
  const boardsArg = process.argv.indexOf("--boards");
  const nBoards = boardsArg > -1 ? parseInt(process.argv[boardsArg + 1], 10) : 8000;
  const seedArg = process.argv.indexOf("--seed");
  const rand = rng(seedArg > -1 ? parseInt(process.argv[seedArg + 1], 10) : 42);

  await mkdir(OUT, { recursive: true });
  const { pieceSets, boards } = await loadThemes();
  console.log(`themes: ${pieceSets.length} piece sets x ${boards.length} boards`);

  const meta: { pieceSet: string; board: string }[] = [];
  let shardTiles: Buffer[] = [];
  let shardLabels: string[] = [];
  let shardIdx = 0;

  const flush = async () => {
    if (shardTiles.length === 0) return;
    const id = String(shardIdx).padStart(3, "0");
    await writeFile(join(OUT, `shard-${id}.bin`), Buffer.concat(shardTiles));
    await writeFile(join(OUT, `shard-${id}.labels`), shardLabels.join("\n") + "\n");
    shardIdx++;
    shardTiles = [];
    shardLabels = [];
  };

  const procedural = process.argv.includes("--procedural");

  for (let b = 0; b < nBoards; b++) {
    let ps = pieceSets[Math.floor(rand() * pieceSets.length)];
    let theme: Theme;
    if (procedural) {
      const hatch = rand() < 0.25;
      if (hatch && rand() < 0.7) {
        const printPool = pieceSets.filter((s) => PRINT_SETS.includes(s.name));
        ps = printPool[Math.floor(rand() * printPool.length)] || ps;
      }
      theme = {
        pieceSet: ps.name,
        pieceDir: ps.dir,
        pieceExt: ps.ext,
        board: hatch ? "proc-hatch" : "proc-flat",
        boardPath: hatch ? proceduralHatchBoard(rand) : proceduralFlatBoard(rand),
      };
    } else {
      const bd = boards[Math.floor(rand() * boards.length)];
      theme = { pieceSet: ps.name, pieceDir: ps.dir, pieceExt: ps.ext, board: bd.name, boardPath: bd.path };
    }
    const size = 8 * Math.round((320 + rand() * 780) / 8);
    const names = samplePosition(rand);

    const rendered = await renderBoard(theme, names, size, rand);
    const rgba = await degrade(rendered, size, rand);
    const gray = rgbaToGray(new Uint8ClampedArray(rgba), size, size);

    const jitter = () => Math.round((rand() - 0.5) * 6);
    const corners = { x0: jitter(), y0: jitter(), x1: size + jitter(), y1: size + jitter() };
    const tiles = boardToTiles(extractBoardImage(gray, corners));

    const u8 = Buffer.alloc(tiles.length);
    for (let i = 0; i < tiles.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(tiles[i] * 255)));
    shardTiles.push(u8);
    shardLabels.push(names.join(""));
    meta.push({ pieceSet: theme.pieceSet, board: theme.board });

    if (shardTiles.length >= SHARD_SIZE) await flush();
    if ((b + 1) % 500 === 0) console.log(`${b + 1}/${nBoards}`);
  }
  await flush();
  await writeFile(join(OUT, "meta.json"), JSON.stringify(meta));
  console.log(`done: ${nBoards} boards -> ${shardIdx} shards in ${OUT}`);
}

main();
