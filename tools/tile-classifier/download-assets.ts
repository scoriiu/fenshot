/**
 * Downloads board + piece theme assets for tile-classifier training.
 *
 *   npx tsx tools/tile-classifier/download-assets.ts
 *
 * Sources:
 *   - lichess piece sets (SVG) and board textures from the lila repo
 *   - chess.com piece sets (PNG) and board textures from their CDN
 *
 * Assets land in .tmp/scan-assets/ (gitignored, re-downloadable).
 * They are TRAINING INPUT ONLY and are never redistributed or shipped;
 * only the trained weights ship.
 */

import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";

const OUT = ".tmp/scan-assets";

const LICHESS_PIECE_SETS = [
  "alpha", "anarcandy", "caliente", "california", "cardinal", "cburnett",
  "celtic", "chess7", "chessnut", "companion", "cooke", "disguised",
  "dubrovny", "fantasy", "firi", "fresca", "gioco", "governor", "horsey",
  "icpieces", "kiwen-suwi", "kosal", "leipzig", "letter", "maestro",
  "merida", "monarchy", "mono", "mpchess", "papercut", "pirouetti",
  "pixel", "reillycraig", "rhosgfx", "riohacha", "shahi-ivory-brown",
  "shapes", "spatial", "staunty", "tatiana", "totoy", "xkcd",
];

const LICHESS_BOARDS = [
  "blue-marble.jpg", "blue.png", "blue2.jpg", "blue3.jpg", "brown.png",
  "canvas2.jpg", "green-plastic.png", "green.png", "grey.jpg", "horsey.jpg",
  "ic.png", "leather.jpg", "maple.jpg", "maple2.jpg", "marble.jpg",
  "metal.jpg", "ncf-board.png", "olive.jpg", "pink-pyramid.png",
  "purple-diag.png", "purple.png", "wood.jpg", "wood2.jpg", "wood3.jpg",
  "wood4.jpg",
];

const CHESSCOM_PIECE_SETS = [
  "neo", "classic", "wood", "glass", "gothic", "metal", "marble", "bases",
  "icy_sea", "club", "alpha", "modern", "vintage", "light", "lolz", "luca",
  "maya", "neo_wood", "game_room", "tournament", "book", "8_bit",
  "bubblegum", "dash", "graffiti", "nature", "neon", "newspaper", "ocean",
  "sky", "space", "tigers", "cases", "3d_staunton", "3d_wood", "3d_plastic",
  "3d_chesskid", "blindfold",
];

const CHESSCOM_BOARDS = [
  "green", "brown", "blue", "bubblegum", "burled_wood", "dark_wood", "dash",
  "glass", "graffiti", "icy_sea", "light", "lolz", "marble", "metal",
  "neon", "newspaper", "orange", "overlay", "parchment", "purple", "red",
  "sand", "sky", "stone", "tan", "tournament", "translucent", "walnut",
  "8_bit", "bases",
];

const PIECE_CODES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchToFile(url: string, dest: string): Promise<boolean> {
  if (await exists(dest)) return true;
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) return false;
  await writeFile(dest, buf);
  return true;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  let ok = 0;
  let fail = 0;

  const pieceJobs: { url: string; dest: string }[] = [];
  for (const set of LICHESS_PIECE_SETS) {
    const dir = join(OUT, "pieces", `lichess-${set}`);
    await mkdir(dir, { recursive: true });
    for (const code of PIECE_CODES) {
      pieceJobs.push({
        url: `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/${set}/${code}.svg`,
        dest: join(dir, `${code}.svg`),
      });
    }
  }
  for (const set of CHESSCOM_PIECE_SETS) {
    const dir = join(OUT, "pieces", `chesscom-${set}`);
    await mkdir(dir, { recursive: true });
    for (const code of PIECE_CODES) {
      pieceJobs.push({
        url: `https://images.chesscomfiles.com/chess-themes/pieces/${set}/150/${code.toLowerCase()}.png`,
        dest: join(dir, `${code}.png`),
      });
    }
  }

  const boardJobs: { url: string; dest: string }[] = [];
  const lichessBoardDir = join(OUT, "boards", "lichess");
  await mkdir(lichessBoardDir, { recursive: true });
  for (const name of LICHESS_BOARDS) {
    boardJobs.push({
      url: `https://raw.githubusercontent.com/lichess-org/lila/master/public/images/board/${name}`,
      dest: join(lichessBoardDir, name),
    });
  }
  const chesscomBoardDir = join(OUT, "boards", "chesscom");
  await mkdir(chesscomBoardDir, { recursive: true });
  for (const name of CHESSCOM_BOARDS) {
    boardJobs.push({
      url: `https://images.chesscomfiles.com/chess-themes/boards/${name}/200.png`,
      dest: join(chesscomBoardDir, `${name}.png`),
    });
  }

  await pool([...pieceJobs, ...boardJobs], 12, async (job) => {
    const success = await fetchToFile(job.url, job.dest);
    if (success) ok++;
    else {
      fail++;
      console.log("MISS", job.url);
    }
  });

  console.log(`done: ${ok} ok, ${fail} missing`);
}

main();
