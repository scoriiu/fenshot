/**
 * Captures REAL browser screenshots of chess sites rendering known
 * positions, for the eval gate. Labels are true by construction: we
 * put the FEN in the URL, the site renders it, the screenshot is a
 * genuine full-page capture (site chrome, sidebars, cookie banners
 * and all), which exercises detection in context, not just tiles.
 *
 *   npx tsx tools/tile-classifier/build-web-eval.ts
 *
 * Output: .tmp/web-eval/<case>.png + testset-manifest.json in the
 * same format as packages/fenshot/tests/fixtures. Evaluate with:
 *
 *   npx tsx tools/tile-classifier/eval-real.ts \
 *     --model packages/fenshot/model/chess-tiles-v2.onnx \
 *     --fixtures .tmp/web-eval
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { chromium, type Page } from "playwright";

const OUT = ".tmp/web-eval";

interface Position {
  id: string;
  /** Piece placement only (what the recognizer returns). */
  placement: string;
  /** Full FEN for the URL. */
  fen: string;
}

/** Positions chosen to probe distinct things: dense openings, sparse
 *  endgames (orientation signal weak), and Q/K/q/k separation (the
 *  legacy model's classic confusion). */
const POSITIONS: Position[] = [
  {
    id: "italian",
    placement: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R",
    fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4",
  },
  {
    id: "qgd-middlegame",
    placement: "r2q1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2N1PN2/PP3PPP/R2QKB1R",
    fen: "r2q1rk1/pp1nbppp/2p1pn2/3p2B1/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9",
  },
  {
    id: "kp-endgame",
    placement: "8/8/4k3/8/4P3/4K3/8/8",
    fen: "8/8/4k3/8/4P3/4K3/8/8 w - - 0 1",
  },
  {
    id: "queens-only",
    placement: "6k1/2Q5/8/8/8/2q5/8/6K1",
    fen: "6k1/2Q5/8/8/8/2q5/8/6K1 w - - 0 1",
  },
];

const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "mobile", width: 390, height: 844 },
];

async function dismissBanners(page: Page) {
  for (const text of ["Accept", "I agree", "Agree", "OK"]) {
    const btn = page.getByRole("button", { name: text, exact: false }).first();
    try {
      await btn.click({ timeout: 1500 });
      return;
    } catch {
      /* not present */
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Record<string, { fen: string; orientation: string; expect: string }> = {};
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent:
        vp.id === "mobile"
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          : undefined,
      deviceScaleFactor: vp.id === "mobile" ? 2 : 1,
    });
    const page = await context.newPage();

    for (const pos of POSITIONS) {
      const name = `lichess-${pos.id}-${vp.id}.png`;
      const url = `https://lichess.org/analysis/${pos.fen.replace(/ /g, "_")}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await dismissBanners(page);
        await page.waitForSelector("cg-board", { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, name) });
        manifest[name] = { fen: pos.placement, orientation: "white", expect: "match" };
        console.log("OK  ", name);
      } catch (e) {
        console.log("MISS", name, String(e).slice(0, 100));
      }
    }
    await context.close();
  }

  // Piece-set and board-theme sweeps on desktop via the dasher.
  // Selections persist per context, so set once, then capture the
  // sweep positions. monarchy is deliberately included: it was pruned
  // from the training corpus, a true out-of-distribution probe.
  const PIECE_SETS = ["merida", "alpha", "horsey", "anarcandy", "monarchy", "staunty"];
  const BOARD_THEMES = ["Wood", "Marble", "Purple"];
  const sweepPositions = POSITIONS.filter((p) => p.id === "italian" || p.id === "queens-only");

  async function openDasherPanel(page: Page, panel: string) {
    await page.click("#top .dasher");
    await page.waitForTimeout(600);
    await page.locator("#dasher_app").getByText(panel, { exact: true }).click();
    await page.waitForTimeout(600);
  }

  for (const set of PIECE_SETS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto("https://lichess.org/analysis", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("cg-board", { timeout: 10000 });
      await openDasherPanel(page, "Piece set");
      await page.locator("#dasher_app").getByTitle(set).click();
      await page.waitForTimeout(600);
      for (const pos of sweepPositions) {
        const name = `lichess-${pos.id}-${set}.png`;
        await page.goto(`https://lichess.org/analysis/${pos.fen.replace(/ /g, "_")}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForSelector("cg-board", { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, name) });
        manifest[name] = { fen: pos.placement, orientation: "white", expect: "match" };
        console.log("OK  ", name);
      }
    } catch (e) {
      console.log("MISS", `pieceset ${set}`, String(e).slice(0, 100));
    }
    await context.close();
  }

  for (const theme of BOARD_THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto("https://lichess.org/analysis", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("cg-board", { timeout: 10000 });
      await openDasherPanel(page, "Board");
      await page.locator("#dasher_app").getByTitle(theme).click();
      await page.waitForTimeout(600);
      for (const pos of sweepPositions) {
        const name = `lichess-${pos.id}-board-${theme.toLowerCase()}.png`;
        await page.goto(`https://lichess.org/analysis/${pos.fen.replace(/ /g, "_")}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForSelector("cg-board", { timeout: 10000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(OUT, name) });
        manifest[name] = { fen: pos.placement, orientation: "white", expect: "match" };
        console.log("OK  ", name);
      }
    } catch (e) {
      console.log("MISS", `board ${theme}`, String(e).slice(0, 100));
    }
    await context.close();
  }

  await browser.close();
  await writeFile(join(OUT, "testset-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n${Object.keys(manifest).length} cases -> ${OUT}/testset-manifest.json`);
}

main();
