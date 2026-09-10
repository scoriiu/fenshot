/**
 * End-to-end through the built extension: dist/ is loaded into
 * Chromium, a fixture page is the active tab, and the popup runs its
 * real main(): screenshot -> recognizer -> position, plus page text ->
 * games. Assertions are on what the user sees in the popup DOM.
 *
 * Two test-only manifest tweaks, applied to a copy of dist/ (the real
 * manifest is untouched):
 *  - host_permissions <all_urls> stands in for the activeTab grant that
 *    a real toolbar click provides; Playwright cannot click the
 *    toolbar, and captureVisibleTab accepts nothing narrower.
 *  - a fixed "key" makes the extension id deterministic so the popup
 *    URL is known up front.
 *
 * The popup must run while the fixture tab is the active one (that is
 * what captureVisibleTab and tabs.query resolve against), so it is
 * opened as a background tab via chrome.tabs.create from a helper tab.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXT_DIR, serveRepo } from "./helpers";

let context: BrowserContext;
let site: Awaited<ReturnType<typeof serveRepo>>;
let popupUrl: string;
let tmp: string;
/** One extension page kept open for the whole file, used only to call chrome.tabs.create. */
let helper: Page;
let lastCapture = 0;

function buildTestExtension(): { dir: string; id: string } {
  const dist = join(EXT_DIR, "dist");
  if (!existsSync(join(dist, "manifest.json"))) {
    throw new Error("dist/ missing: run `npm run build` in apps/extension first (or use `npm run test:e2e`)");
  }
  tmp = mkdtempSync(join(tmpdir(), "fenshot-e2e-"));
  const dir = join(tmp, "ext");
  cpSync(dist, dir, { recursive: true });

  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  const id = createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  manifest.key = der.toString("base64");
  manifest.host_permissions = ["<all_urls>"];
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, id };
}

beforeAll(async () => {
  const ext = buildTestExtension();
  popupUrl = `chrome-extension://${ext.id}/index.html`;
  [context, site] = await Promise.all([
    chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${ext.dir}`, `--load-extension=${ext.dir}`],
    }),
    serveRepo(),
  ]);
  // The helper is itself the popup page, so opening it costs one
  // captureVisibleTab; do it once, and never again.
  helper = await context.newPage();
  await helper.goto(popupUrl);
  lastCapture = Date.now();
}, 60_000);

afterAll(async () => {
  await context?.close();
  site?.server.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/**
 * Open the popup against `fixture` exactly as a toolbar click would:
 * fixture tab active, popup running in the same window. Returns the
 * popup page once its main() has settled on a result or hub screen.
 */
async function openPopupOn(fixture: string): Promise<{ page: Page; popup: Page }> {
  const page = await context.newPage();
  await page.goto(site.fixture(fixture));
  await page.bringToFront();
  // Chrome caps captureVisibleTab at 2 calls/second (a quota error,
  // not a permission one); each popup open is one call, so pace them.
  const wait = lastCapture + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const popupPromise = context.waitForEvent("page");
  await helper.evaluate((url) => chrome.tabs.create({ url, active: false }), popupUrl);
  lastCapture = Date.now();
  const popup = await popupPromise;
  popup.on("console", (msg) => {
    if (msg.type() === "error") console.log("[popup error]", msg.text());
  });
  popup.on("pageerror", (err) => console.log("[popup pageerror]", err.message));
  await popup.waitForSelector(".actions, .paths", { timeout: 45_000 });
  return { page, popup };
}

describe("popup end-to-end", () => {
  it("chessgames-style page: position and game, Coachess primary, contract URL", async () => {
    const { page, popup } = await openPopupOn("chessgames.html");
    try {
      // Board read from the screenshot (the fixture embeds a lichess screenshot).
      await popup.waitForSelector(".board");
      const primary = popup.locator(".actions .btn.primary");
      await expect.poll(() => primary.textContent()).toBe("Analyze on Coachess");
      const posHref = (await primary.getAttribute("href"))!;
      expect(posHref).toMatch(/^https:\/\/coachess\.app\/coach\/position\?fen=/);
      expect(posHref).toContain("utm_campaign=position");
      await expect.poll(() => popup.locator(".actions .btn:not(.primary)").first().textContent()).toBe("Lichess");

      // Game from the page text.
      await popup.waitForSelector(".games");
      expect(await popup.locator(".games-title").textContent()).toBe("Game on this page");
      expect(await popup.locator(".game").count()).toBe(1);
      expect(await popup.locator(".game-label").textContent()).toBe("Game (23 moves)");

      const game = popup.locator(".game-actions a").first();
      expect(await game.textContent()).toBe("Coachess");
      expect(await game.getAttribute("class")).toContain("primary");
      const href = new URL((await game.getAttribute("href"))!);
      expect(href.origin + href.pathname).toBe("https://coachess.app/coach/position");
      expect(href.searchParams.get("fen")).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      expect(href.searchParams.get("moves")!.split(",")).toHaveLength(45);
      expect(href.searchParams.get("result")).toBe("1-0");
      expect(href.searchParams.get("utm_campaign")).toBe("game-import");
      expect(href.searchParams.has("pgn")).toBe(false);

      const lichess = popup.locator(".game-actions a").nth(1);
      expect(await lichess.getAttribute("href")).toMatch(/^https:\/\/lichess\.org\/analysis\/pgn\/e4_e5_f4_exf4/);
    } finally {
      await popup.close();
      await page.close();
    }
  });

  it("lichess-style page: headers reach the label and the Coachess URL", async () => {
    const { page, popup } = await openPopupOn("lichess.html");
    try {
      await popup.waitForSelector(".games");
      expect(await popup.locator(".game-label").textContent()).toBe("DrNykterstein \u2013 Hikaru, 2023 (8 moves)");
      const href = new URL((await popup.locator(".game-actions a").first().getAttribute("href"))!);
      expect(href.searchParams.get("white")).toBe("DrNykterstein");
      expect(href.searchParams.get("black")).toBe("Hikaru");
      expect(href.searchParams.get("date")).toBe("2023.05.20");
      expect(href.searchParams.get("result")).toBe("0-1");
    } finally {
      await popup.close();
      await page.close();
    }
  });

  it("article with two games and no board: hub screen lists both, longest first", async () => {
    const { page, popup } = await openPopupOn("article.html");
    try {
      await popup.waitForSelector(".paths");
      await popup.waitForSelector(".games");
      expect(await popup.locator(".games-title").textContent()).toBe("2 games on this page");
      expect(await popup.locator(".game-label").allTextContents()).toEqual(["Game (7 moves)", "Game (4 moves)"]);
      // The hub's own recovery paths are still there, untouched.
      expect(await popup.locator(".paths .btn").allTextContents()).toEqual([
        "Select the board on this page",
        "Upload an image",
      ]);
    } finally {
      await popup.close();
      await page.close();
    }
  });

  it("page with neither board nor game: popup is exactly the pre-existing hub", async () => {
    const { page, popup } = await openPopupOn("nogame.html");
    try {
      await popup.waitForSelector(".paths");
      // Give the game scan a moment to land; it must not add anything.
      await popup.waitForTimeout(1000);
      expect(await popup.locator(".games").count()).toBe(0);
      expect(await popup.locator(".state p").first().textContent()).toBe("No chessboard found on this page.");
    } finally {
      await popup.close();
      await page.close();
    }
  });
});
