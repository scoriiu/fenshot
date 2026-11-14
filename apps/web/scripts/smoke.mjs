// After a build: the result screen works on every kind of page.
//   npm run build && node scripts/smoke.mjs
// Serves dist/ the way the host does (a missing file is a 404, not the app),
// reads a board on the English page and on language pages at phone size, and
// fails on any request that fails, a board without pieces, an editor that
// does not edit, a page that grew wider than the screen, or a missing position. The start screen alone does
// not catch these: the board and its piece set load only with a result.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../dist/", import.meta.url).pathname;
const IMAGE = new URL("../../extension/tests/e2e/fixtures/lichess-endgame-black.png", import.meta.url).pathname;
const PAGES = ["/", "/de/", "/ru/", "/ar/", "/zh/"];
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".onnx": "application/octet-stream" };

const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(req.url.split("?")[0]));
  if (path.endsWith("/")) path += "index.html";
  const file = join(DIST, path);
  try {
    if (!file.startsWith(DIST) || !(await stat(file)).isFile()) throw new Error("missing");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/html" }).end("<style>body{background:#f1f1f1}li{display:table-cell}</style>not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const problems = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };
for (const [path, screen] of [...PAGES.map((p) => [p, PHONE]), ["/de/", DESKTOP]]) {
  const width = screen.viewport.width;
  const page = await (await browser.newContext(screen)).newPage();
  const failed = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(origin, "")}`);
  });
  page.on("pageerror", (e) => failed.push(`error ${e.message}`));
  await page.goto(origin + path);
  await page.setInputFiles("input[type=file]", IMAGE);
  await page.waitForSelector("code.fen", { timeout: 30000 }).catch(() => failed.push("no position shown"));
  await page.waitForTimeout(800);
  // The board is an editor: with the bin in hand, a press on a piece takes it off and the FEN follows.
  const before = await page.evaluate(() => document.querySelectorAll(".board-host .ls-piece").length);
  const fenBefore = await page.locator("code.fen").textContent().catch(() => null);
  let edited = false;
  if (before > 0) {
    await page.locator('.spares [data-tool="erase"]').first().click();
    const piece = await page.locator(".board-host .ls-piece").first().boundingBox();
    await page.mouse.click(piece.x + piece.width / 2, piece.y + piece.height / 2);
    await page.waitForTimeout(400);
    edited = (await page.locator(".board-host .ls-piece").count()) === before - 1 && (await page.locator("code.fen").textContent()) !== fenBefore;
  }
  const seen = await page.evaluate(() => {
    const piece = document.querySelector(".board-host .ls-piece");
    const board = document.querySelector(".board-host .ls-board")?.getBoundingClientRect();
    const fileA = [...document.querySelectorAll(".board-host .ls-coord")].find((c) => c.textContent === "a")?.getBoundingClientRect();
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      // A piece of the set, drawn: its picture is a data address of the Kibitzo set, not "none".
      pieceSet: !!piece && getComputedStyle(piece).backgroundImage.includes("kibitzo"),
      spares: document.querySelectorAll(".spares .spare").length,
      // Also in a right-to-left page the board runs from the a-file on the left (this picture is read with White at the bottom).
      leftToRight: !!board && !!fileA && fileA.left - board.left < board.width / 8,
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  const pieceSet = seen.pieceSet;
  seen.pieces = before;
  if (!edited) problems.push(`${path}: the bin did not take a piece off the board`);
  if (!seen.leftToRight) problems.push(`${path}: the a-file is not on the left of the board`);
  if (seen.spares !== 16) problems.push(`${path}: the palette has ${seen.spares} buttons, not 16`);
  if (seen.scrollWidth > seen.width) problems.push(`${path}: the page is wider than the screen (${seen.scrollWidth} on ${seen.width})`);
  if (failed.length) problems.push(`${path}: ${failed.join(", ")}`);
  if (seen.width !== width) problems.push(`${path}: page is ${seen.width}px wide on a ${width}px screen`);
  if (!pieceSet || !seen.pieces) problems.push(`${path}: the board has no piece set`);
  if (seen.background !== "rgb(12, 17, 23)") problems.push(`${path}: page background became ${seen.background}`);
  const ok = !failed.length && seen.width === width && pieceSet && seen.pieces > 0 && edited && seen.leftToRight && seen.spares === 16 && seen.scrollWidth <= seen.width && seen.background === "rgb(12, 17, 23)";
  console.log(`${path.padEnd(6)} ${String(width).padEnd(5)} ${ok ? "ok" : "FAIL"}`);
  await page.close();
}
await browser.close();
server.close();
if (problems.length) {
  console.error("\n" + problems.join("\n"));
  process.exit(1);
}
