/**
 * Real Chromium, real DOM, real innerText. `collectPageText` is the
 * function the extension injects; here Playwright injects it, and the
 * strings it returns go through the same `findGames` the popup uses.
 * No extension shell involved: this pins the DOM -> text -> game path,
 * which is where site-specific layouts (chessgames' whitespace-free
 * anchors, lichess' dot-less indices) actually bite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { collectPageText, findGames } from "../../src/pgn";
import { collectBoardSides, sideOfBoard } from "../../src/board-side";
import { serveRepo } from "./helpers";

let browser: Browser;
let site: Awaited<ReturnType<typeof serveRepo>>;

beforeAll(async () => {
  [browser, site] = await Promise.all([chromium.launch(), serveRepo()]);
});

afterAll(async () => {
  await browser?.close();
  site?.server.close();
});

async function gamesOn(fixture: string) {
  const page = await browser.newPage();
  try {
    await page.goto(site.fixture(fixture));
    const texts = await page.evaluate(collectPageText);
    return { texts, games: findGames(texts) };
  } finally {
    await page.close();
  }
}

describe("collectPageText + findGames in a real browser", () => {
  it("chessgames.com layout: anchors with no whitespace, board image, trailing result", async () => {
    const { texts, games } = await gamesOn("chessgames.html");
    // Sanity: the browser really did glue the anchors together.
    expect(texts.some((t) => t.includes("1.e4e52.f4exf4"))).toBe(true);
    expect(games).toHaveLength(1);
    expect(games[0].moves).toHaveLength(45);
    expect(games[0].moves.at(-1)).toBe("Be7#");
    expect(games[0].headers.Result).toBe("1-0");
  });

  it("lichess layout: dot-less indices plus a PGN textarea; one game with headers", async () => {
    const { games } = await gamesOn("lichess.html");
    expect(games).toHaveLength(1);
    expect(games[0].moves).toHaveLength(16); // the textarea is the longer rendering
    expect(games[0].headers).toMatchObject({ White: "DrNykterstein", Black: "Hikaru", Result: "0-1" });
    expect(games[0].label).toBe("DrNykterstein \u2013 Hikaru, 2023 (8 moves)");
  });

  it("chess.com with figurine notation: the piece is an icon (not text), still read as SAN; the page is left untouched", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(site.fixture("chesscom-figurine.html"));
      const before = await page.evaluate(() => document.body.innerHTML);
      const texts = await page.evaluate(collectPageText);
      expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);
      const games = findGames(texts);
      expect(games).toHaveLength(1);
      expect(games[0].moves).toEqual("e4 e5 Qh5 Nh6 Bc4 Bc5 Qxe5+ Be7 Qxg7 Bf6 Qxh6 Rg8 Qxh7 Nc6 Qxf7#".split(" "));
    } finally {
      await page.close();
    }
  });

  it("article with two games and prose numbering: both games, longest first, prose ignored", async () => {
    const { games } = await gamesOn("article.html");
    expect(games.map((g) => g.moves.length)).toEqual([13, 7]);
    expect(games.map((g) => g.moves.at(-1))).toEqual(["Nd5#", "Qxf7#"]);
  });

  it("page without a game yields nothing", async () => {
    const { games } = await gamesOn("nogame.html");
    expect(games).toEqual([]);
  });
});

describe("collectBoardSides in a real browser", () => {
  it("reports each board's place in the viewport and the side at its bottom", async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    try {
      await page.goto(site.fixture("board-sides.html"));
      const boards = await page.evaluate(collectBoardSides);
      // The 20px board is a thumbnail, not something a user reads.
      expect(boards).toHaveLength(4);
      const at = (x0: number, y0: number, x1: number, y1: number) => sideOfBoard({ x0, y0, x1, y1 }, boards);
      expect(at(0.1, 0.05, 0.5, 0.45)).toBe("black");
      expect(at(0.6, 0.05, 0.8, 0.25)).toBe("white");
      expect(at(0.1, 0.5, 0.4, 0.8)).toBe("black");
      expect(at(0.5, 0.5, 0.8, 0.8)).toBe("white");
      expect(at(0.85, 0.85, 0.99, 0.99)).toBeNull();
    } finally {
      await page.close();
    }
  });
});
