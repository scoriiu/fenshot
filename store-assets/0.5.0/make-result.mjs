// Store screenshot 4 (0.5.0): what "Analyze on Kibitzo" opens for the hero's
// board, here with the whole Opera Game, on production kibitzo.com.
// Run from the fenshot repo root: node store-assets/0.5.0/make-result.mjs
import { chromium } from "playwright";
const MOVES = "e4,e5,Nf3,d6,d4,Bg4,dxe5,Bxf3,Qxf3,dxe5,Bc4,Nf6,Qb3,Qe7,Nc3,c6,Bg5,b5,Nxb5,cxb5,Bxb5+,Nbd7,O-O-O,Rd8,Rxd7,Rxd7,Rd1,Qe6,Bxd7+,Nxd7,Qb8+,Nxb8,Rd8#";
const q = new URLSearchParams({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", moves: MOVES, white: "Paul Morphy", black: "Duke Karl / Count Isouard", result: "1-0" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
await page.goto(`https://kibitzo.com/coach/position?${q}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
console.log("HEADER", (await page.locator("body").innerText()).split("\n").slice(0, 4).join(" | ").slice(0, 160));
await page.screenshot({ path: "store-assets/0.5.0/raw/result-page.png" });
await browser.close();
