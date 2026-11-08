/**
 * Builds the public accuracy benchmark: real third-party renders and real
 * page screenshots of known positions, plus images with no board at all.
 *
 *   npx tsx tools/benchmark/build.ts            # all sources
 *   npx tsx tools/benchmark/build.ts --only lichess-page-themed,no-board
 *
 * Truth comes from outside fenshot: positions are Lichess puzzle positions
 * (positions.json), and every image is drawn by the site itself (Lichess,
 * chess.com) from the FEN we hand it. No image is drawn by fenshot code.
 *
 * Images land in .tmp/benchmark/images/ (not committed: the artwork belongs
 * to the sites). cases.json (committed) lists each image's source URL or
 * capture recipe, its true placement and its sha256, so anyone can rebuild
 * the same set and check it is the same.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { chromium, type Browser, type Page } from "playwright";

const DIR = "tools/benchmark";
const IMAGES = ".tmp/benchmark/images";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

interface Position { id: string; phase: string; fen: string }
export interface Case {
  file: string;
  source: string;
  /** Piece placement the image shows, from White's side; null = no board. */
  placement: string | null;
  orientation: "white" | "black" | null;
  phase: string | null;
  config: string;
  /** Piece artwork was part of the training corpus. */
  seenInTraining: boolean | null;
  recipe: string;
  sha256: string;
}

/** Sets pruned from training (tools/tile-classifier/README.md). */
const UNSEEN_SETS = new Set(["monarchy", "mono", "disguised", "3d_staunton", "3d_wood", "3d_plastic", "3d_chesskid"]);

const positions: Position[] = JSON.parse(readFileSync(join(DIR, "positions.json"), "utf8")).positions;
const placementOf = (fen: string) => fen.split(" ")[0];
const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lichess asks for a full minute's pause after a 429; honour it. */
async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } }).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    await sleep(res?.status === 429 ? 65000 : 2000 * (attempt + 1));
  }
  return null;
}

const imageDone = (file: string) => existsSync(join(IMAGES, file));

/** Lichess's own site, with its piece set and board changed through the
 *  settings menu (the GIF export rate-limits a benchmark-sized run). */
const LICHESS_CONFIGS: [string, string][] = [
  ["merida", "wood4"], ["alpha", "marble"], ["companion", "blue2"], ["staunty", "green"], ["horsey", "purple"],
  ["maestro", "maple"], ["fresca", "olive"], ["cardinal", "grey"], ["kosal", "metal"], ["monarchy", "brown"],
];

async function openDasherPanel(page: Page, panel: string) {
  await page.click("#top .dasher");
  await sleep(600);
  await page.locator("#dasher_app").getByText(panel, { exact: true }).click();
  await sleep(600);
}

async function lichessThemed(browser: Browser): Promise<Case[]> {
  const out: Case[] = [];
  const sample = positions.filter((_, i) => i % 4 === 2);
  for (const [k, [piece, board]] of LICHESS_CONFIGS.entries()) {
    const ctx = await browser.newContext(VIEWPORTS.desktop);
    const page = await ctx.newPage();
    try {
      await page.goto("https://lichess.org/analysis", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("cg-board", { timeout: 15000 });
      await openDasherPanel(page, "Piece set");
      await page.locator("#dasher_app").getByTitle(piece, { exact: true }).click();
      await sleep(500);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("cg-board", { timeout: 15000 });
      await openDasherPanel(page, "Board");
      await page.locator("#dasher_app").getByTitle(board, { exact: true }).click();
      await sleep(500);
    } catch (e) {
      console.log("MISS lichess-themed config", piece, board, String(e).slice(0, 80));
      await ctx.close();
      continue;
    }
    for (const [j, p] of sample.slice(k * 6, k * 6 + 6).entries()) {
      const orientation = j % 3 === 2 ? "black" : "white";
      const url = `https://lichess.org/analysis/standard/${p.fen.replace(/ /g, "_")}${orientation === "black" ? "?color=black" : ""}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector("cg-board piece", { timeout: 15000 });
        await sleep(900);
        const buf = await page.screenshot();
        const file = `lichess-themed-${p.id}.png`;
        writeFileSync(join(IMAGES, file), buf);
        out.push({ file, source: "lichess-page-themed", placement: placementOf(p.fen), orientation, phase: p.phase, config: `${board}/${piece}`, seenInTraining: !UNSEEN_SETS.has(piece), recipe: `screenshot of ${url} at desktop viewport, Lichess settings: piece set ${piece}, board ${board}`, sha256: sha(buf) });
      } catch (e) {
        console.log("MISS lichess-themed", p.id, String(e).slice(0, 80));
      }
      await sleep(1500);
    }
    await ctx.close();
  }
  return out;
}

const CC_BOARDS = ["green", "brown", "blue", "marble", "icy_sea", "walnut", "tournament", "purple", "newspaper", "sky", "dark_wood", "glass"];
const CC_PIECES = ["neo", "classic", "wood", "glass", "alpha", "game_room", "neo_wood", "icy_sea", "tournament", "vintage", "club", "3d_wood", "3d_staunton", "3d_plastic"];

async function chesscomDynboard(): Promise<Case[]> {
  const out: Case[] = [];
  for (const [i, p] of positions.entries()) {
    const board = CC_BOARDS[i % CC_BOARDS.length];
    const piece = CC_PIECES[i % CC_PIECES.length];
    const flip = i % 4 === 1;
    const coords = i % 3 === 0 ? "&coordinates=inside" : "";
    const url = `https://www.chess.com/dynboard?fen=${encodeURIComponent(placementOf(p.fen))}&board=${board}&piece=${piece}&size=3${flip ? "&flip=true" : ""}${coords}`;
    const file = `chesscom-img-${p.id}.png`;
    const cached = imageDone(file);
    const buf = cached ? readFileSync(join(IMAGES, file)) : await download(url);
    if (!buf) { console.log("MISS chesscom-dynboard", p.id); continue; }
    if (!cached) writeFileSync(join(IMAGES, file), buf);
    out.push({ file, source: "chesscom-image", placement: placementOf(p.fen), orientation: flip ? "black" : "white", phase: p.phase, config: `${board}/${piece}`, seenInTraining: !UNSEEN_SETS.has(piece), recipe: url, sha256: sha(buf) });
    if (!cached) await sleep(800);
  }
  return out;
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: UA },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
} as const;

async function dismissBanners(page: Page) {
  for (const name of ["Accept all", "Accept", "I agree", "Agree", "Got it", "OK"]) {
    try {
      await page.getByRole("button", { name, exact: false }).first().click({ timeout: 800 });
      return;
    } catch { /* none */ }
  }
}

const SITE_SAMPLE = positions.filter((_, i) => i % 4 === 0);

async function lichessSite(browser: Browser): Promise<Case[]> {
  const out: Case[] = [];
  for (const vp of ["desktop", "mobile"] as const) {
    const ctx = await browser.newContext(VIEWPORTS[vp]);
    const page = await ctx.newPage();
    for (const [i, p] of SITE_SAMPLE.entries()) {
      if (i % 2 !== (vp === "desktop" ? 0 : 1)) continue;
      const orientation = i % 3 === 2 ? "black" : "white";
      const url = `https://lichess.org/analysis/standard/${p.fen.replace(/ /g, "_")}${orientation === "black" ? "?color=black" : ""}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await dismissBanners(page);
        await page.waitForSelector("cg-board piece", { timeout: 15000 });
        await sleep(900);
        const buf = await page.screenshot();
        const file = `lichess-site-${vp}-${p.id}.png`;
        writeFileSync(join(IMAGES, file), buf);
        out.push({ file, source: "lichess-page", placement: placementOf(p.fen), orientation, phase: p.phase, config: `${vp}/default`, seenInTraining: true, recipe: `screenshot of ${url} at ${vp} viewport`, sha256: sha(buf) });
      } catch (e) {
        console.log("MISS lichess-site", p.id, String(e).slice(0, 80));
      }
    }
    await ctx.close();
  }
  return out;
}

/** Reads the placement chess.com actually rendered, so a page that ignored
 *  the FEN is dropped as a chess.com fault instead of scored against us. */
async function renderedChesscomPlacement(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const grid: string[][] = Array.from({ length: 8 }, () => Array(8).fill("1"));
    const pieces = document.querySelectorAll("wc-chess-board .piece, chess-board .piece");
    if (!pieces.length) return null;
    pieces.forEach((el) => {
      const cls = [...el.classList];
      const kind = cls.find((c) => /^[wb][kqrbnp]$/.test(c));
      const sq = cls.find((c) => /^square-\d\d$/.test(c));
      if (!kind || !sq) return;
      const file = parseInt(sq[7], 10) - 1;
      const rank = parseInt(sq[8], 10) - 1;
      grid[7 - rank][file] = kind[0] === "w" ? kind[1].toUpperCase() : kind[1];
    });
    return grid.map((row) => row.join("").replace(/1+/g, (m) => String(m.length))).join("/");
  });
}

async function chesscomSite(browser: Browser): Promise<Case[]> {
  const out: Case[] = [];
  for (const vp of ["desktop", "mobile"] as const) {
    const ctx = await browser.newContext(VIEWPORTS[vp]);
    const page = await ctx.newPage();
    for (const [i, p] of SITE_SAMPLE.entries()) {
      if (i % 2 !== (vp === "desktop" ? 1 : 0)) continue;
      const flip = i % 3 === 1;
      const url = `https://www.chess.com/analysis?fen=${encodeURIComponent(p.fen)}${flip ? "&flip=true" : ""}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await dismissBanners(page);
        await page.waitForSelector("wc-chess-board .piece, chess-board .piece", { timeout: 20000 });
        await sleep(2500);
        const rendered = await renderedChesscomPlacement(page);
        if (rendered !== placementOf(p.fen)) { console.log("SKIP chesscom-site (page showed another position)", p.id); continue; }
        const orientation = (await page.evaluate(() => !!document.querySelector("wc-chess-board.flipped, chess-board.flipped"))) ? "black" : "white";
        const buf = await page.screenshot();
        const file = `chesscom-site-${vp}-${p.id}.png`;
        writeFileSync(join(IMAGES, file), buf);
        out.push({ file, source: "chesscom-page", placement: placementOf(p.fen), orientation, phase: p.phase, config: `${vp}/default`, seenInTraining: true, recipe: `screenshot of ${url} at ${vp} viewport`, sha256: sha(buf) });
      } catch (e) {
        console.log("MISS chesscom-site", p.id, String(e).slice(0, 80));
      }
      await sleep(1500);
    }
    await ctx.close();
  }
  return out;
}

/** Pages with no chess board: encyclopedia articles, news, docs, and chess
 *  pages that are text only. A tool that "finds" a board here is lying. */
const NEGATIVE_URLS = [
  "https://en.wikipedia.org/wiki/Typography", "https://en.wikipedia.org/wiki/Magnus_Carlsen", "https://en.wikipedia.org/wiki/Elo_rating_system",
  "https://en.wikipedia.org/wiki/Checkerboard", "https://en.wikipedia.org/wiki/Crossword", "https://en.wikipedia.org/wiki/Sudoku",
  "https://en.wikipedia.org/wiki/Go_(game)", "https://en.wikipedia.org/wiki/Spreadsheet", "https://en.wikipedia.org/wiki/Tile",
  "https://en.wikipedia.org/wiki/Mondrian", "https://en.wikipedia.org/wiki/Periodic_table", "https://en.wikipedia.org/wiki/Calendar",
  "https://en.wikipedia.org/wiki/Keyboard_layout", "https://en.wikipedia.org/wiki/QR_code", "https://en.wikipedia.org/wiki/Rubik%27s_Cube",
  "https://en.wikipedia.org/wiki/Tartan", "https://en.wikipedia.org/wiki/Bauhaus", "https://en.wikipedia.org/wiki/Football",
  "https://lichess.org/blog", "https://lichess.org/about", "https://lichess.org/faq", "https://lichess.org/source",
  "https://www.chess.com/about", "https://www.chess.com/news", "https://github.com/lichess-org/lila",
  "https://github.com/official-stockfish/Stockfish", "https://news.ycombinator.com/", "https://www.bbc.com/news",
  "https://developer.mozilla.org/en-US/docs/Web/CSS/grid", "https://www.python.org/", "https://www.apple.com/",
  "https://www.ikea.com/", "https://maps.google.com/", "https://en.wikipedia.org/wiki/Pixel_art",
  "https://en.wikipedia.org/wiki/Graph_paper", "https://en.wikipedia.org/wiki/Bathroom_tile",
  "https://en.wikipedia.org/wiki/Picnic_blanket", "https://en.wikipedia.org/wiki/Racing_flags", "https://en.wikipedia.org/wiki/Op_art",
  "https://en.wikipedia.org/wiki/Waffle",
];

async function negatives(browser: Browser): Promise<Case[]> {
  const out: Case[] = [];
  for (const vp of ["desktop", "mobile"] as const) {
    const ctx = await browser.newContext(VIEWPORTS[vp]);
    const page = await ctx.newPage();
    for (const [i, url] of NEGATIVE_URLS.entries()) {
      if (i % 2 !== (vp === "desktop" ? 0 : 1)) continue;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await dismissBanners(page);
        await sleep(2000);
        const hasBoard = await page.evaluate(() => !!document.querySelector("cg-board, wc-chess-board, chess-board, .chess-board"));
        if (hasBoard) { console.log("SKIP negative (page shows a board)", url); continue; }
        const buf = await page.screenshot();
        const file = `negative-${vp}-${i}.png`;
        writeFileSync(join(IMAGES, file), buf);
        out.push({ file, source: "no-board", placement: null, orientation: null, phase: null, config: vp, seenInTraining: null, recipe: `screenshot of ${url} at ${vp} viewport`, sha256: sha(buf) });
      } catch (e) {
        console.log("MISS negative", url, String(e).slice(0, 80));
      }
    }
    await ctx.close();
  }
  return out;
}

async function main() {
  mkdirSync(IMAGES, { recursive: true });
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
  const want = (s: string) => !only || only.has(s);
  const casesPath = join(DIR, "cases.json");
  const prior: Case[] = existsSync(casesPath) ? JSON.parse(readFileSync(casesPath, "utf8")).cases : [];
  const fresh: Case[] = [];
  if (want("chesscom-image")) fresh.push(...(await chesscomDynboard()));
  const browser = await chromium.launch();
  if (want("lichess-page-themed")) fresh.push(...(await lichessThemed(browser)));
  if (want("lichess-page")) fresh.push(...(await lichessSite(browser)));
  if (want("chesscom-page")) fresh.push(...(await chesscomSite(browser)));
  if (want("no-board")) fresh.push(...(await negatives(browser)));
  await browser.close();
  const rebuilt = new Set(fresh.map((c) => c.source));
  const cases = [...prior.filter((c) => !rebuilt.has(c.source)), ...fresh].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(casesPath, JSON.stringify({ built: new Date().toISOString().slice(0, 10), cases }, null, 1) + "\n");
  console.log(`${cases.length} cases -> ${casesPath}`);
}

main();
