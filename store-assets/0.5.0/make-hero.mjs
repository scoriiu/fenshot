// Store screenshot 1 (0.5.0): Wikipedia's Opera Game article, and the REAL
// fenshot popup reading its final-position diagram. The board image is
// pasted into the popup (its own paste path), so the result on screen is
// the network's actual read, not a mock-up.
// Run from the fenshot repo root after `npm run build -w extension`:
//   node store-assets/0.5.0/make-hero.mjs
import { chromium } from "playwright";
import path from "node:path";

const OUT = "store-assets/0.5.0/raw";
const ext = path.resolve("apps/extension/dist");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto("https://en.wikipedia.org/wiki/Opera_Game", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const board = page.locator(".chessboard").last();
await board.evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 150));
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/hero-page.png` });
const boardPng = await board.screenshot({ path: `${OUT}/hero-board.png` });
await browser.close();

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 360, height: 600 });
await popup.goto(`chrome-extension://${new URL(sw.url()).host}/index.html`);
await popup.waitForTimeout(2500);
await popup.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "board.png", { type: "image/png" }));
  window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
}, boardPng.toString("base64"));
await popup.waitForSelector(".board", { timeout: 60000 }).catch(() => undefined);
await popup.waitForTimeout(1500);
// Opera Game final position: Black has just been mated, so Black is to move.
await popup.getByRole("button", { name: "Black", exact: true }).click();
await popup.waitForTimeout(1000);
const wrap = popup.locator(".wrap");
const text = (await wrap.innerText()).replace(/\s+/g, " ").slice(0, 200);
console.log("POPUP", text);
await wrap.screenshot({ path: `${OUT}/hero-popup.png` });
await ctx.close();
