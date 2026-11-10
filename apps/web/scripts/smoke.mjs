// After a build: the result screen works on every kind of page.
//   npm run build && node scripts/smoke.mjs
// Serves dist/ the way the host does (a missing file is a 404, not the app),
// reads a board on the English page and on language pages at phone size, and
// fails on any request that fails, a board without pieces, a page that grew
// wider than the screen, or a missing position. The start screen alone does
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
  let pieceSet = false;
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(origin, "")}`);
    else if (r.url().includes("/cm-chessboard/pieces/") && (r.headers()["content-type"] ?? "").includes("svg")) pieceSet = true;
  });
  page.on("pageerror", (e) => failed.push(`error ${e.message}`));
  await page.goto(origin + path);
  await page.setInputFiles("input[type=file]", IMAGE);
  await page.waitForSelector("code.fen", { timeout: 30000 }).catch(() => failed.push("no position shown"));
  await page.waitForTimeout(800);
  const seen = await page.evaluate(() => ({
    width: innerWidth,
    pieces: document.querySelectorAll(".board-host svg use, .result-board svg use, svg.cm-chessboard use").length,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  if (failed.length) problems.push(`${path}: ${failed.join(", ")}`);
  if (seen.width !== width) problems.push(`${path}: page is ${seen.width}px wide on a ${width}px screen`);
  if (!pieceSet || !seen.pieces) problems.push(`${path}: the board has no piece set`);
  if (seen.background !== "rgb(12, 17, 23)") problems.push(`${path}: page background became ${seen.background}`);
  const ok = !failed.length && seen.width === width && pieceSet && seen.pieces > 0 && seen.background === "rgb(12, 17, 23)";
  console.log(`${path.padEnd(6)} ${String(width).padEnd(5)} ${ok ? "ok" : "FAIL"}`);
  await page.close();
}
await browser.close();
server.close();
if (problems.length) {
  console.error("\n" + problems.join("\n"));
  process.exit(1);
}
