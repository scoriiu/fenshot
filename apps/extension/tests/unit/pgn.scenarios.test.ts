/**
 * Scenario suite for the game scanner. Four parts:
 *   1. layouts     text exactly as real sites hand it over via innerText
 *   2. boundaries  several games / sources in one text
 *   3. adversarial commentary that quotes other legal moves
 *   4. generated   random legal games with generated commentary, where
 *                  alternative lines are real legal moves from the
 *                  actual position (the hardest case for the scanner)
 */
import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import { findGames, scanGames, coachessGameUrl, lichessGameUrl } from "../../src/pgn";

const only = (text: string | string[]) => {
  const games = findGames(Array.isArray(text) ? text : [text]);
  expect(games, `expected one game, got ${games.length}: ${games.map((g) => g.moves.join(" ")).join(" | ")}`).toHaveLength(1);
  return games[0];
};

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGame(seed: number, plies: number): string[] {
  const rand = rng(seed);
  const c = new Chess();
  for (let i = 0; i < plies; i++) {
    const ms = c.moves();
    if (!ms.length) break;
    c.move(ms[Math.floor(rand() * ms.length)]);
  }
  return c.history();
}

/** "1.e4e52.Nf3" chessgames style with optional per-ply suffix text. */
function glued(moves: string[], after: (i: number) => string = () => ""): string {
  return moves.map((m, i) => (i % 2 ? m : `${i / 2 + 1}.${m}`) + after(i)).join("");
}

const ITALIAN = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Nc3", "Nxe4"];

describe("1. layouts", () => {
  it("chess.com article with figurines", () => {
    const g = only("1.\u2658f3 \u2658f6 2.c4 g6 3.\u2658c3 \u2657g7 4.d4 O-O 5.\u2657f4 d5 6.\u2655b3 dxc4");
    expect(g.moves).toEqual(["Nf3", "Nf6", "c4", "g6", "Nc3", "Bg7", "d4", "O-O", "Bf4", "d5", "Qb3", "dxc4"]);
  });

  it("wikipedia: en-dash result, footnote markers, parenthesised names", () => {
    const g = only(
      "The game continued 1. e4 e5 2. Nf3 Nc6 3. Bb5 (the Ruy Lopez) a6[3] 4. Ba4 Nf6 5. O-O Be7 6. Re1[4] b5 7. Bb3 d6 1\u20130",
    );
    expect(g.moves).toHaveLength(14);
    expect(g.headers.Result).toBe("1-0");
  });

  it("unicode half-point with en dash", () => {
    expect(only("1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 dxc4 \u00bd\u2013\u00bd").headers.Result).toBe("1/2-1/2");
  });

  it("en passant written with e.p.", () => {
    const g = only("1. e4 Nf6 2. e5 d5 3. exd6 e.p. Qxd6 4. d4 Nc6 5. Nf3 Bg4");
    expect(g.moves).toEqual(["e4", "Nf6", "e5", "d5", "exd6", "Qxd6", "d4", "Nc6", "Nf3", "Bg4"]);
  });

  it("evaluation glyphs after moves", () => {
    const g = only("1. e4 e5 2. Nf3\u00b1 Nc6 3. Bb5= a6 4. Ba4+= Nf6 5. O-O\u221e Be7 6. Re1+- b5-+");
    expect(g.moves).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5"]);
  });

  it("non-breaking spaces and CRLF", () => {
    const g = only("1.\u00a0e4\u00a0e5\r\n2.\u00a0Nf3\u00a0Nc6\r\n3.\u00a0Bb5\u00a0a6\r\n4.\u00a0Ba4\u00a0Nf6");
    expect(g.moves).toHaveLength(8);
  });

  it("lichess: bare numbers one per line plus PGN textarea, glued together by innerText", () => {
    const g = only(["1\ne4\ne5\n2\nNf3\nNc6\n3\nBb5\na6", '[White "A"]\n[Black "B"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *']);
    expect(g.moves).toHaveLength(8);
    expect(g.label).toBe("A \u2013 B (4 moves)");
  });

  it("forum post with alternatives at the same number, real move quoted last", () => {
    const g = only(
      "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 and now 6.Be3 or 6.Bg5 are both playable, the game went 6.Bg5 e6 7.f4 Be7 8.Qf3 Qc7 9.O-O-O Nbd7",
    );
    expect(g.moves.slice(10)).toEqual(["Bg5", "e6", "f4", "Be7", "Qf3", "Qc7", "O-O-O", "Nbd7"]);
  });

  it("black move interrupted by prose, resumed with an explicit number", () => {
    const g = only("1. e4 e5 2. Nf3 Nc6 3. Bb5 White develops with tempo. 3... a6 4. Ba4 Nf6 5. O-O Be7");
    expect(g.moves).toHaveLength(10);
  });

  it("result after prose, no more moves", () => {
    const g = only(glued(ITALIAN) + " and White resigned a few moves later. 0-1");
    expect(g.moves).toEqual(ITALIAN);
    expect(g.headers.Result).toBe("0-1");
  });

  it("truncated by an unreadable move: no result claimed", () => {
    const g = only("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. B?? Nf6 5. O-O Be7 1-0");
    expect(g.moves).toHaveLength(6);
    expect(g.headers.Result).toBeUndefined();
  });

  it("promotion and disambiguation survive canonicalisation", () => {
    const g = only("1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8=Q Nb6 6. Qxc8 Qxc8");
    expect(g.moves[7]).toBe("Nbd7");
    expect(g.moves[8]).toBe("bxa8=Q");
    const u = new URL(coachessGameUrl(g));
    expect(u.searchParams.get("moves")!.split(",")).toEqual(g.moves);
  });
});

describe("2. boundaries", () => {
  it("unfinished game followed by another game does not splice", () => {
    const games = findGames(["Game A: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 Game B: 1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O"]);
    expect(games.map((g) => g.moves.join(" "))).toEqual(["d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O", "e4 e5 Nf3 Nc6 Bb5 a6"]);
  });

  it("short unfinished game before a longer one is dropped, not merged", () => {
    const games = findGames(["1. e4 e5 2. Nf3 Nc6 then 1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5"]);
    expect(games).toHaveLength(1);
    expect(games[0].moves[0]).toBe("d4");
  });

  it("multi-game PGN: each game keeps its own headers, none inherited", () => {
    const text = `[Event "Open"]
[White "One"]
[Black "Two"]
[Date "2020.01.01"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 1-0

[Event "Open"]
[White "Three"]
[Black "Four"]
[Result "0-1"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 0-1`;
    const games = findGames([text]);
    expect(games).toHaveLength(2);
    const second = games.find((g) => g.moves[0] === "d4")!;
    expect(second.headers.White).toBe("Three");
    expect(second.headers.Date).toBeUndefined();
    expect(second.headers.Result).toBe("0-1");
    const first = games.find((g) => g.moves[0] === "e4")!;
    expect(first.headers.Date).toBe("2020.01.01");
  });

  it("[Event tag is a boundary even without a result", () => {
    const games = findGames(['1. e4 e5 2. Nf3 Nc6 3. Bb5 a6\n[Event "x"]\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7']);
    expect(games.map((g) => g.moves.length)).toEqual([8, 6]);
  });

  it("numbered prose list around a game does not disturb it", () => {
    const g = only("Steps: 1. open the app 2. click analyze 3. done. The game: 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6. Notes: 6. profit");
    expect(g.moves).toHaveLength(10);
  });

  it("many stray '1.' anchors stay fast", () => {
    const filler = Array.from({ length: 400 }, (_, i) => `${(i % 9) + 1}. item ${i}`).join(" ");
    const text = `${filler} ${glued(ITALIAN)} ${filler}`;
    const t0 = performance.now();
    expect(only(text).moves).toEqual(ITALIAN);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("3. adversarial commentary", () => {
  // Byrne–Fischer through 17...Be6, then move 18 onwards.
  const BF = "1.Nf3Nf62.c4g63.Nc3Bg74.d4O-O5.Bf4d56.Qb3dxc47.Qxc4c68.e4Nbd79.Rd1Nb610.Qc5Bg411.Bg5Na412.Qa3Nxc313.bxc3Nxe414.Bxe7Qb615.Bc4Nxc316.Bc5Rfe8+17.Kf1Be6";
  const BF_REST = "18.Bxb6Bxc4+19.Kg1Ne2+20.Kf1Nxd4+21.Kg1Ne2+22.Kf1Nc3+23.Kg1axb624.Qb4Ra425.Qxb6Nxd126.h3Rxa227.Kh2Nxf228.Re1Rxe129.Qd8+Bf830.Nxe1Bd531.Nf3Ne432.Qb8b533.h4h534.Ne5Kg735.Kg1Bc5+36.Kf1Ng3+37.Ke1Bb4+38.Kd1Bb3+39.Kc1Ne2+40.Kb1Nc3+41.Kc1Rc2#0-1";
  const MATING_LINE = "18. Bxe6 Qb5+ 19. Kg1 Ne2+ 20. Kf1 Ng3+ 21. Kg1 Qf1+ 22. Rxf1 Ne2#";

  it("a full inline mating variation before the real move loses to the main line", () => {
    const g = only(`${BF} Declining is not easy: ${MATING_LINE} is the point. ${BF_REST}`);
    expect(g.moves).toHaveLength(82);
    expect(g.moves[34]).toBe("Bxb6");
    expect(g.headers.Result).toBe("0-1");
  });

  it("the same variation after the real move is ignored", () => {
    const g = only(`${BF}18.Bxb6Instead ${MATING_LINE} was threatened.18...Bxc4+${BF_REST.slice("18.Bxb6Bxc4+".length)}`);
    expect(g.moves).toHaveLength(82);
    expect(g.moves[35]).toBe("Bxc4+");
  });

  it("a legal alternative for Black quoted before the explicit real move", () => {
    // 13...h6 is legal here; the game went 13...Nf6 and later moves need that knight.
    const pre = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1";
    const g = only(`${pre} Here h6 is also possible. 13... Bf8 14. Ng3 g6 15. a4 c5 16. d5 c4 17. Bg5 h6 18. Be3 Nc5`);
    expect(g.moves.slice(24)).toEqual(["Nf1", "Bf8", "Ng3", "g6", "a4", "c5", "d5", "c4", "Bg5", "h6", "Be3", "Nc5"]);
  });

  it("a legal alternative for Black quoted after the real move", () => {
    const pre = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1";
    const g = only(`${pre} Bf8 rather than 13... h6 14. Ng3 g6 15. a4 c5 16. d5 c4 17. Bg5 h6 18. Be3 Nc5`);
    expect(g.moves[25]).toBe("Bf8");
    expect(g.moves).toHaveLength(36);
  });

  it("commentary quoting the opening moves again does not restart the game", () => {
    const g = only(`${glued(ITALIAN)} The opening 1. e4 e5 2. Nf3 is the most common start.`);
    expect(g.moves).toEqual(ITALIAN);
  });
});

describe("4. generated commentary on random legal games", () => {
  const PROSE = [
    "A natural developing move.",
    "White faces considerable difficulties; the king is exposed.",
    "Better was to castle. -- Wade",
    "This tactical scenario is sometimes called a windmill.",
    "Every piece and pawn is defended, the queen has nothing to do.",
    "Now Black is hopelessly entangled in the mating net!",
  ];

  /**
   * chessgames-style annotated rendering: moves glued to numbers, prose
   * glued after moves, and after an interrupted black move the explicit
   * "n..." marker. Alternatives are legal moves from the real position,
   * quoted with their number, placed after the real move (the common
   * kibitz shape) or before it (the hard shape).
   */
  function annotate(moves: string[], seed: number, opts: { altBefore: boolean }): string {
    const rand = rng(seed * 7919);
    const c = new Chess();
    let out = "";
    let interrupted = false;
    for (let i = 0; i < moves.length; i++) {
      const n = Math.floor(i / 2) + 1;
      const white = i % 2 === 0;
      const legal = c.moves().filter((m) => m !== moves[i]);
      const alt = legal.length ? legal[Math.floor(rand() * legal.length)] : null;
      const altText = (m: string) => `${n}.${white ? " " : ".. "}${m}`;

      let before = "";
      if (opts.altBefore && alt && rand() < 0.25) before = ` Also possible was ${altText(alt)} with an unclear game. `;
      if (before) out += before;
      if (white) out += `${n}.`;
      else if (before || interrupted) out += `${n}...`; // chessgames re-numbers Black after any comment
      out += moves[i];
      c.move(moves[i]);

      interrupted = false;
      if (rand() < 0.3) {
        out += PROSE[Math.floor(rand() * PROSE.length)];
        if (!opts.altBefore && alt && rand() < 0.5) out += ` Instead ${altText(alt)} was worth a look.`;
        if (rand() < 0.5) out += " ";
        interrupted = true;
      }
    }
    return out + ["1-0", "0-1", "1/2-1/2"][seed % 3];
  }

  /**
   * Independent oracle: after playing the alternative instead of the
   * real move, does the rest of the real game stay legal to the end?
   * If so the text genuinely describes two equally long games and no
   * parser could prefer one; such seeds are skipped.
   */
  function altIsViable(moves: string[], at: number, alt: string): boolean {
    const c = new Chess();
    for (let i = 0; i < at; i++) c.move(moves[i]);
    try {
      c.move(alt);
      for (let i = at + 1; i < moves.length; i++) c.move(moves[i]);
      return true;
    } catch {
      return false;
    }
  }

  it("prose and alternatives after moves: exact recovery", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const moves = randomGame(seed, 30 + (seed % 4) * 30);
      if (moves.length < 6) continue;
      const text = annotate(moves, seed, { altBefore: false });
      const games = findGames([text]);
      expect(games, `seed ${seed}: ${text.slice(0, 200)}`).toHaveLength(1);
      expect(games[0].moves, `seed ${seed}`).toEqual(moves);
      expect(games[0].headers.Result, `seed ${seed}`).toBe(["1-0", "0-1", "1/2-1/2"][seed % 3]);
    }
  }, 30_000);

  it("alternatives before the real move: recovered wherever the text is not genuinely ambiguous", () => {
    let exact = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const moves = randomGame(seed, 30 + (seed % 4) * 30);
      if (moves.length < 6) continue;
      const text = annotate(moves, seed, { altBefore: true });
      // Plies where a quoted alternative is indistinguishable from the
      // real move for the rest of the game: no parser can prefer one,
      // and the test does not demand it. Everywhere else: exact.
      const ambiguous = new Set<number>();
      for (const m of text.matchAll(/Also possible was (\d+)\.(?:\.\. )?\s?(\S+) with/g)) {
        const ply = (parseInt(m[1], 10) - 1) * 2 + (m[0].includes("...") ? 1 : 0);
        if (altIsViable(moves, ply, m[2])) ambiguous.add(ply);
      }
      const games = findGames([text]);
      expect(games, `seed ${seed}: ${text.slice(0, 200)}`).toHaveLength(1);
      const got = games[0].moves;
      expect(got.length, `seed ${seed}: line length`).toBe(moves.length);
      for (let i = 0; i < moves.length; i++) {
        if (!ambiguous.has(i)) expect(got[i], `seed ${seed} ply ${i}`).toBe(moves[i]);
      }
      if (ambiguous.size === 0) exact += 1;
    }
    expect(exact).toBeGreaterThan(3);
  }, 30_000);

  it("a page never takes long: 240-ply game with an alternative quoted at every ply", () => {
    const moves = randomGame(7, 240);
    const c = new Chess();
    let text = "";
    for (let i = 0; i < moves.length; i++) {
      const n = Math.floor(i / 2) + 1;
      const alt = c.moves().find((m) => m !== moves[i]);
      if (alt) text += ` Or ${n}.${i % 2 ? ".. " : " "}${alt} first. `;
      text += (i % 2 ? (alt ? `${n}...` : "") : `${n}.`) + moves[i];
      c.move(moves[i]);
    }
    const t0 = performance.now();
    const g = only(text);
    // Pathological ceiling (the budget bounds the search); a real
    // annotated page is two orders of magnitude cheaper, see below.
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(g.moves.length).toBe(moves.length);
  });

  it("a real annotated page is fast", () => {
    const BF = "1.Nf3Nf62.c4g63.Nc3Bg74.d4O-O5.Bf4d56.Qb3dxc47.Qxc4c68.e4Nbd79.Rd1Nb610.Qc5Bg411.Bg511. Be2 followed by 12. O-O would have been more prudent. -- Wade11...Na4!12.Qa3On 12. Nxa4 Nxe4 and White faces considerable difficulties.12...Nxc3At first glance; however, Fischer's plan is the opposite.13.bxc3Nxe414.Bxe7Qb615.Bc4Nxc316.Bc5Rfe8+17.Kf1Be6!! Declining: 18. Bxe6 leads to mate with ...Qb5+ 19. Kg1 Ne2+ 20. Kf1 Ng3+ 21. Kg1 Qf1+ 22. Rxf1 Ne2#. Or 18. Qxc3 Qxc518.Bxb6Bxc4+19.Kg1Ne2+20.Kf1Nxd4+21.Kg1Ne2+22.Kf1Nc3+23.Kg1axb624.Qb4Ra425.Qxb6Nxd126.h3Rxa227.Kh2Nxf228.Re1Rxe129.Qd8+Bf830.Nxe1Bd531.Nf3Ne432.Qb8b533.h4h534.Ne5Kg735.Kg1Bc5+36.Kf1Ng3+37.Ke1Bb4+38.Kd1Bb3+39.Kc1Ne2+40.Kb1Nc3+41.Kc1Rc2#0-1";
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) expect(only(BF).moves).toHaveLength(82);
    expect((performance.now() - t0) / 5).toBeLessThan(150);
  });

  it("plain glued rendering of long games with 3-digit move numbers", () => {
    for (let seed = 100; seed < 110; seed++) {
      const moves = randomGame(seed, 240);
      if (moves.length < 200) continue;
      expect(only(glued(moves)).moves).toEqual(moves);
    }
  });
});

describe("5. starting positions and variants", () => {
  const KC_960_PAGE = `Garry Kasparov vs Magnus Carlsen (2020)
1. d4 d5 2. e3 Nf6 3. Nf3 e6 4. c4 a6 5. Nc3 dc4 6. Bc4 c5 7. dc5 Bc5 8. Qd8 Kd8 9. Bd3 Ke7 10. O-O-O Nc6 11. Ng5 Rd8 12. Nge4 Ne4 13. Ne4 Bb6 14. Bc3 f6 15. g4 Ba5 16. Ba5 Na5 17. Bc2 Bc6 18. Rhg1 Nc4 19. Rd8 Rd8 20. g5 f5 21. Nc3 Ne5 1/2-1/2
[Event "Champions Showdown Chess 9LX"]
[Site "lichess.org INT"]
[Date "2020.09.11"]
[Result "1/2-1/2"]
[White "Garry Kasparov"]
[Black "Magnus Carlsen"]
[SetUp "1"]
[FEN "rnkqbbnr/pppppppp/8/8/8/8/PPPPPPPP/RNKQBBNR w HAha - 0 1"]

1. d4 d5 2. e3 Nf6 3. Nf3 e6 4. c4 a6 5. Nc3 dxc4 6. Bxc4 c5 7. dxc5 Bxc5 8. Qxd8+ Kxd8 9. Bd3 Ke7 10. O-O-O Nc6 11. Ng5 Rd8 1/2-1/2`;

  it("Chess960 page (chessgames gid=2010203) with a FEN tag: no game at all", () => {
    expect(findGames([KC_960_PAGE])).toEqual([]);
  });

  it("Chess960 page as chessgames really renders it: [SetUp] without [FEN], x-less table", () => {
    // Real innerText of gid=2010203, trimmed: move table, kibitz, PGN block whose FEN tag is not printed.
    const real = `Garry Kasparov vs Magnus Carlsen
Champions Showdown Chess 9LX (2020) (unorthodox), lichess.org INT, rd 2, Sep-11
Chess variants (000)  ·  1/2-1/2
A1: go to game start	B1: move 10 half-moves backward	H1: go to game end
	Move:	
white
	Last:	
1.
1. d4 d5 2. e3 Nf6 3. Nf3 e6 4. c4 a6 5. Nc3 dc4 6. Bc4 c5 7. dc5 Bc5 8. Qd8 Kd8 9. Bd3 Ke7 10. O-O-O Nc6 11. Ng5 Rd8 12. Nge4 Ne4 13. Ne4 Bb6 14. Bc3 f6 15. g4 Ba5 16. Ba5 Na5 17. Bc2 Bc6 18. Rhg1 Nc4 19. Rd8 Rd8 20. g5 f5 21. Nc3 Ne5 22. f4 Nf3 23. Rg2 g6 55. Kc4 b51/2-1/2
Updated viewer to 'pgn4web' for 960 games.
Sep-12-20	An Englishman: Good Evening: One odd bit about this game--after 10...Nc6, the position looks as if it had arisen from the Queen's Gambit Accepted.
Sep-12-20	fredthebear: Looks like a pre-arranged draw to me.
[Event "Champions Showdown Chess 9LX"]
[Site "lichess.org INT"]
[Date "2020.09.11"]
[Result "1/2-1/2"]
[White "Garry Kasparov"]
[Black "Magnus Carlsen"]
[ECO "000"]
[PlyCount "110"]
[SetUp "1"]

1. d4 d5 2. e3 Nf6 3. Nf3 e6 4. c4 a6 5. Nc3 dxc4 6. Bxc4 c5 7. dxc5 Bxc5 8. Qxd8+ Kxd8 9. Bd3 Ke7 10. O-O-O Nc6 11. Ng5 Rd8 12. Nge4 Nxe4 13. Nxe4 Bb6 14. Bc3 f6 15. g4 Ba5 16. Bxa5 Nxa5 17. Bc2 Bc6 18. Rhg1 Nc4 19. Rxd8 Rxd8 20. g5 f5 21. Nc3 Ne5 22. f4 Nf3 55. Kc4 b5+ 1/2-1/2

Sep-12-20	RookFile: Kasparov is basically retired from the game.
This game is type: UNORTHODOX.`;
    expect(findGames([real])).toEqual([]);
  });

  it("scanGames reports unsupported games so the popup can say why there is nothing", () => {
    expect(scanGames([KC_960_PAGE])).toEqual({ games: [], unsupported: 1 });
    const mixed = scanGames([`1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0\n\n${KC_960_PAGE}`]);
    expect(mixed.games).toHaveLength(1);
    expect(mixed.unsupported).toBe(1);
    expect(scanGames(["1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"]).unsupported).toBe(0);
  });

  it("O-O-O is never read as O-O with leftovers", () => {
    // After 1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 both sides can castle long only.
    const g = only("1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. O-O-O O-O-O 6. Nf3 Nf6");
    expect(g.moves.slice(8)).toEqual(["O-O-O", "O-O-O", "Nf3", "Nf6"]);
    // Where O-O-O is illegal but O-O would be legal, the line stops rather than mis-reading.
    const h = only("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O-O Nf6 5. d3 d6");
    expect(h.moves).toHaveLength(6);
  });

  it("[Variant] tag other than standard is skipped even with a loadable FEN", () => {
    const text = '[Variant "Crazyhouse"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *';
    expect(findGames([text])).toEqual([]);
  });

  it("capture notation without x, from the standard start", () => {
    const g = only("1. e4 d5 2. ed5 Qd5 3. Nc3 Qa5 4. d4 Nf6 5. Nf3 Bg4 6. h3 Bf3 7. Qf3");
    expect(g.moves).toEqual(["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6", "Nf3", "Bg4", "h3", "Bxf3", "Qxf3"]);
  });

  it("study with a [FEN] start, White to move at move 1 (lichess issue example)", () => {
    const g = only('[FEN "4k3/5pK1/6p1/p7/6P1/7P/P7/8 w - -"]\n\n1. h4 Ke7 2. h5 gxh5 3. gxh5 f5 4. h6 f4 5. h7 *');
    expect(g.startFen).toBe("4k3/5pK1/6p1/p7/6P1/7P/P7/8 w - - 0 1");
    expect(g.moves).toEqual(["h4", "Ke7", "h5", "gxh5", "gxh5", "f5", "h6", "f4", "h7"]);
    expect(g.pgn).toContain('[SetUp "1"]');
    expect(g.pgn).toContain('[FEN "4k3/5pK1/6p1/p7/6P1/7P/P7/8 w - - 0 1"]');
    expect(g.pgn.endsWith("1. h4 Ke7 2. h5 gxh5 3. gxh5 f5 4. h6 f4 5. h7 *")).toBe(true);
  });

  it("fragment starting mid-game with Black to move", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const g = only(`[SetUp "1"]\n[FEN "${fen}"]\n\n3... Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 1-0`);
    expect(g.startFen).toBe(fen);
    expect(g.moves).toEqual(["Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Nc3", "Nxe4"]);
    expect(g.headers.Result).toBe("1-0");
    expect(g.pgn.endsWith("3... Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 1-0")).toBe(true);
  });

  it("URLs carry the starting position", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    const g = only(`[FEN "${fen}"]\n\n3... Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+`);
    const c = new URL(coachessGameUrl(g));
    expect(c.searchParams.get("fen")).toBe(fen);
    expect(c.searchParams.get("moves")).toBe("Bc5,c3,Nf6,d4,exd4,cxd4,Bb4+");
    const l = lichessGameUrl(g);
    expect(l.startsWith("https://lichess.org/analysis/pgn/%5BFEN%20%22r1bqkbnr%2F")).toBe(true);
    expect(l.endsWith("%22%5D_Bc5_c3_Nf6_d4_exd4_cxd4_Bb4%2B")).toBe(true);
    expect(l).not.toContain("+");
  });

  it("a [FEN] equal to the standard start is an ordinary game", () => {
    const g = only('[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    expect(g.startFen).toBeUndefined();
    expect(g.pgn).not.toContain("[FEN");
  });

  it("standard game and a Chess960 game on the same page: only the standard one", () => {
    const games = findGames([`Here: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0\n\n${KC_960_PAGE}`]);
    expect(games).toHaveLength(1);
    expect(games[0].moves[0]).toBe("e4");
  });
});

describe("6. lichess PGN viewer (blog / study pages), real innerText", () => {
  // https://lichess.org/@/Lichess/blog/lichess-game-of-the-month-june-26/a3FwhC4X
  // Main line rendered one token per line ("13." / "..." / "e5??" after a
  // comment), variations glued ("13...Nc5[%anno ...]14.f6gxf6"), nested
  // ones in parentheses, [%anno]/[%clk]/[%cal] commands left in the text.
  const page = readFileSync(new URL("./fixtures/lichess-blog-gotm-june-2026.innertext.txt", import.meta.url), "utf8");

  it("follows the main line through 30+ inline variations, including a transposition", () => {
    const g = only(page);
    expect(g.moves).toHaveLength(63);
    // 6...Nbd7 (game) not 6...e6 (variation that transposes): a true tie in
    // length, resolved by formatting consistency with the line so far.
    expect(g.moves.slice(10, 16)).toEqual(["Bg5", "Nbd7", "f4", "Qc7", "Qf3", "e6"]);
    // 13...e5?? (game) over three annotated alternatives.
    expect(g.moves[25]).toBe("e5");
    expect(g.moves.slice(-3)).toEqual(["Qd5", "d2", "Qxd2"]);
    expect(g.headers.Result).toBe("1-0");
  });

  it("the study PGN itself (Get PGN button) parses identically", () => {
    const pgn = readFileSync(new URL("./fixtures/lichess-gotm-june-2026.pgn", import.meta.url), "utf8");
    const g = only(pgn);
    expect(g.moves).toHaveLength(63);
    expect(g.label).toBe("Bengal_Tiger_2011 \u2013 nguacongamco, 2026 (32 moves)");
  });
});
