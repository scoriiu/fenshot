// Promo tiles (0.5.0): small 440x280 and marquee 1400x560, 24-bit PNG (no
// alpha). Store guidance: little text, strong shapes, legible at half size,
// no screenshots. Rendered at 2x, downscaled by compose-tiles in Python.
// Run from the fenshot repo root: node store-assets/0.5.0/make-tiles.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const piece = (p) => readFileSync(`apps/extension/src/pieces-svg/${p === p.toUpperCase() ? "w" : "b"}${p.toUpperCase()}.svg`, "utf8");
// Opera Game, final position (same as store screenshot 1).
const OPERA = "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5";

function board(placement, size) {
  const ranks = placement.split("/").map((r) => r.replace(/\d/g, (d) => "1".repeat(+d)));
  let sq = "";
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = ranks[r][f];
    sq += `<div style="background:${(r + f) % 2 ? "#b58863" : "#f0d9b5"}">${p === "1" ? "" : piece(p)}</div>`;
  }
  return `<div class="board" style="width:${size}px;height:${size}px">${sq}</div>`;
}

const KNIGHT = `<svg viewBox="6 5 38 40" style="width:1em;height:1em;vertical-align:baseline;margin-right:.45em;transform:scaleX(-1)"><path fill="currentColor" d="M25.192 23.015c-.1654 6.9672-11.758 5.2189-11.516 18.104l22.86.1184c-2.094-6.442 9.69-25.16-11.931-32.258v-.0001s-2.4381-2.601-5.9655-2.8237l.2227 3.5347-4.5583 4.5816c-2.6294 3.1455-8.7347 8.3784-7.7513 9.6111 3.1158 5.3041 6.3306 4.4316 6.3306 4.4316 4.2418-4.5433 5.8193-2.0894 12.309-5.2997z"/><path fill="currentColor" d="M25 36.457s-9.1309.048-11.691 1.6192c-1.7273 1.0602-2.1348 3.6514-1.8998 6.3237h27.182c.235-2.6723-.1725-5.2636-1.8999-6.3237-2.5597-1.5711-11.691-1.6192-11.691-1.6192z"/></svg>`;
const ICON = readFileSync("store-assets/0.5.0/fenshot-store-icon-128.png").toString("base64");

const base = `
  * { box-sizing: border-box; margin: 0; }
  body { background: #0c1117; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow: hidden;
         background-image: radial-gradient(ellipse 70% 80% at 85% 50%, rgba(245,158,11,.10), transparent 70%); }
  .board { display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); border-radius: 6px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55); }
  .board div { display: flex; min-height: 0; } .board svg { width: 100%; height: 100%; }
  .frame { position: relative; padding: 14px; }
  .frame i { position: absolute; width: 34px; height: 34px; border: 4px solid #f59e0b; }
  .frame i:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; border-radius: 8px 0 0 0; }
  .frame i:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; border-radius: 0 8px 0 0; }
  .frame i:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; border-radius: 0 0 0 8px; }
  .frame i:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; border-radius: 0 0 8px 0; }
  .cta { display: inline-flex; align-items: center; padding: 0 26px; height: 64px; border-radius: 12px; background: #f59e0b; color: #0c1117; font-weight: 800; font-size: 24px; white-space: nowrap; box-shadow: 0 10px 30px rgba(245,158,11,.25); }
  .arrow { color: #f59e0b; font-size: 54px; font-weight: 300; line-height: 1; }`;

const marquee = `<!doctype html><html><head><style>${base}
  body { width: 1400px; height: 560px; display: flex; align-items: center; padding: 0 84px; gap: 70px; }
  .copy { flex: 1; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
  .brand img { width: 56px; height: 56px; }
  .brand span { color: #f59e0b; font-size: 34px; font-weight: 800; letter-spacing: -.5px; }
  h1 { color: #f8fafc; font-size: 56px; line-height: 1.08; letter-spacing: -1px; font-weight: 800; }
  h1 em { color: #fbbf24; font-style: normal; }
  p { color: #94a3b8; font-size: 22px; line-height: 1.45; margin-top: 22px; max-width: 520px; }
  .visual { display: flex; align-items: center; gap: 26px; }
</style></head><body>
  <div class="copy">
    <div class="brand"><img src="data:image/png;base64,${ICON}"><span>fenshot</span></div>
    <h1>Any chessboard,<br><em>one click</em> to analysis</h1>
    <p>Boards in videos, books and articles. Finished games on chess.com and Lichess.</p>
  </div>
  <div class="visual">
    <div class="frame"><i></i><i></i><i></i><i></i>${board(OPERA, 300)}</div>
    <div class="arrow">&rarr;</div>
    <div class="cta">${KNIGHT}Analyze</div>
  </div>
</body></html>`;

const small = `<!doctype html><html><head><style>${base}
  body { width: 440px; height: 280px; display: flex; align-items: center; padding: 0 30px; gap: 24px; }
  .frame { padding: 9px; } .frame i { width: 22px; height: 22px; border-width: 3px; }
  .t .name { color: #f59e0b; font-size: 34px; font-weight: 800; letter-spacing: -.5px; }
  .t p { color: #e2e8f0; font-size: 20px; line-height: 1.3; margin-top: 8px; font-weight: 600; }
</style></head><body>
  <div class="frame"><i></i><i></i><i></i><i></i>${board(OPERA, 156)}</div>
  <div class="t"><div class="name">fenshot</div><p>Any chessboard to analysis, one click</p></div>
</body></html>`;

const browser = await chromium.launch();
for (const [name, html, w, h] of [["marquee-1400x560", marquee, 1400, 560], ["small-440x280", small, 440, 280]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `store-assets/0.5.0/raw/tile-${name}@2x.png` });
  await page.close();
}
await browser.close();
console.log("rendered");
