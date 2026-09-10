import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { findGames, coachessGameUrl, coachessPositionUrl, lichessGameUrl, type FoundGame } from "../../src/pgn";

const USER_SAMPLE_CHESSGAMES =
  "1.e4e52.f4exf43.Bc4Qh4+4.Kf1g55.Nc3Bg76.d4d67.Nd5Kd88.Be2Nf69.Nxf6Bxf610.e5Be711.Qd3Nc612.c3Bd713.g3Qh614.exd6Bxd615.h4g416.Bd1Qf617.Ke1Qe7+18.Kf2Re819.gxf4Qe1+20.Kg2Qe4+21.Qxe4Rxe422.Bc2Re823.Bxh7Be624.Kg3Bd525.Rh2Re126.Ne2Bc427.d5Ne728.Nd4Nxd529.h5Rg1+30.Kf2Rf1+31.Kg3Nxf432.Kxg4Kd733.b3Be6+34.Nxe6Nxe635.Re2Rh836.Be4Rg8+37.Kh4Be7+38.Kh3Bd639.h6Rxc140.h7Rxc3+41.Kh4Be7+42.Kh5Rh3#0-1";

const FISCHER_SPASSKY = `[Event "F/S Return Match"]
[Site "Belgrade, Serbia JUG"]
[Date "1992.11.04"]
[Round "29"]
[White "Fischer, Robert J."]
[Black "Spassky, Boris V."]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {This opening is called the Ruy Lopez.} a6
4. Ba4 Nf6 5. O-O Be7 (5... Nxe4 6. Re1 (6. d4 b5)) 6. Re1 b5 7. Bb3 d6 8. c3 O-O $1
9. h3 Nb8 10. d4 Nbd7 1/2-1/2`;

const RUY = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"];

function one(text: string | string[]): FoundGame {
  const games = findGames(Array.isArray(text) ? text : [text]);
  expect(games, `expected exactly one game in: ${JSON.stringify(text).slice(0, 80)}`).toHaveLength(1);
  return games[0];
}

describe("findGames: real-world layouts", () => {
  it("chessgames.com innerText (no whitespace at all, full game, trailing result)", () => {
    const g = one(USER_SAMPLE_CHESSGAMES);
    expect(g.moves).toHaveLength(84);
    expect(g.moves[0]).toBe("e4");
    expect(g.moves.at(-1)).toBe("Rh3#");
    expect(g.headers.Result).toBe("0-1");
    expect(g.label).toBe("Game (42 moves)");
  });

  it("chessgames.com inline-dotted with spaces", () => {
    const g = one("1.e4 c5 2.Nf3 e6 3.d4 cxd4 4.Nxd4 Nc6 5.Nb5 d6 6.c4 Nf6 7.N1c3 a6 8.Na3 d5 1-0");
    expect(g.moves).toHaveLength(16);
    expect(g.moves[12]).toBe("N1c3");
    expect(g.headers.Result).toBe("1-0");
  });

  it("standard PGN with headers, comments, nested variations and NAGs", () => {
    const g = one(FISCHER_SPASSKY);
    expect(g.moves).toEqual([...RUY, "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Nb8", "d4", "Nbd7"]);
    expect(g.headers).toMatchObject({
      White: "Fischer, Robert J.",
      Black: "Spassky, Boris V.",
      Date: "1992.11.04",
      Result: "1/2-1/2",
    });
    expect(g.label).toBe("Fischer, Robert J. \u2013 Spassky, Boris V., 1992 (10 moves)");
  });

  it("lichess innerText: bare numbers, one token per line", () => {
    const g = one("1\ne4\ne5\n2\nNf3\nNc6\n3\nBb5\na6\n4\nBa4\nNf6\n5\nO-O\nBe7");
    expect(g.moves).toEqual(RUY);
  });

  it("lichess innerText glued without dots", () => {
    const g = one("1e4e52Nf3Nc63Bb5a64Ba4Nf65O-OBe7");
    expect(g.moves).toEqual(RUY);
  });

  it("chess.com style: dotted numbers with spaces, castling and checks", () => {
    const g = one("1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2 O-O 5. a3 Bxc3+ 6. Qxc3 b6 7. Bg5 Bb7");
    expect(g.moves).toHaveLength(14);
    expect(g.moves[9]).toBe("Bxc3+");
  });

  it("game embedded in prose", () => {
    const g = one(
      "Here is the famous miniature: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# and White wins. Comments below.",
    );
    expect(g.moves).toEqual(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);
  });
});

describe("findGames: normalisation", () => {
  it("zeros castling becomes letters, annotations stripped", () => {
    const short = one("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 d6 6. Bg5 h6 7. Bh4 g5 8. Bg3 0-0!?");
    expect(short.moves[6]).toBe("O-O");
    expect(short.moves[15]).toBe("O-O");
    const long = one("1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. 0-0-0?? 0-0-0 6. Nf3!");
    expect(long.moves[8]).toBe("O-O-O");
    expect(long.moves[9]).toBe("O-O-O");
    expect(long.moves[10]).toBe("Nf3");
  });

  it("promotion with and without '='", () => {
    const pre = "1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8=Q Nb6 6. Qxc8";
    expect(one(pre).moves[8]).toBe("bxa8=Q");
    expect(one(pre.replace("bxa8=Q", "bxa8Q")).moves[8]).toBe("bxa8Q");
  });

  it("unicode ½-½ result normalised", () => {
    expect(one("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 \u00bd-\u00bd").headers.Result).toBe("1/2-1/2");
  });

  it("result in PGN header wins over the movetext token", () => {
    const g = one('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    expect(g.headers.Result).toBe("1-0");
  });

  it("truncated line carries no result even when a result token follows", () => {
    const g = one("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Kxe8 Nf6 0-1");
    expect(g.moves).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(g.headers.Result).toBeUndefined();
  });

  it("pgn output replays to the same moves", () => {
    const g = one(FISCHER_SPASSKY);
    const c = new Chess();
    c.loadPgn(g.pgn);
    expect(c.history()).toEqual(g.moves);
    expect(g.pgn.endsWith(" 1/2-1/2")).toBe(true);
  });
});

describe("findGames: rejection", () => {
  it.each([
    ["prose numbered list", "1. Introduction 2. Methods 3. Results 4. Discussion 5. Conclusion"],
    ["german notation", "1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6"],
    ["fragment not from the start", "12...Nf6 13. Bg5 h6 14. Bh4 g5 15. Bg3 Ne4"],
    ["glued fragment not from the start", "99.Kf2Kg7100.Kf3Kg6101.Kf4Kh5"],
    ["too short", "1. e4 e5 2. Nf3"],
    ["numbers only", "1 2 3 4 5 6 7 8 9 10"],
    ["dates and versions", "Released 1.2.3 on 2024.01.15, see section 1.e and 2.f"],
    ["empty", ""],
  ])("%s", (_name, text) => {
    expect(findGames([text])).toEqual([]);
  });

  it("illegal move ends the line, legal prefix kept when long enough", () => {
    const g = one("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. Kxe8 Be7 6. Re1 b5");
    expect(g.moves).toEqual(RUY.slice(0, 8));
  });
});

describe("findGames: multiple games and de-duplication", () => {
  it("two different games in one text, longest first", () => {
    const games = findGames([
      "A: 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 1-0\nB: 1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 dxc4 5. a4 Bf5 6. e3 e6 1/2-1/2",
    ]);
    expect(games.map((g) => g.moves.length)).toEqual([12, 10]);
    expect(games.map((g) => g.headers.Result)).toEqual(["1/2-1/2", "1-0"]);
  });

  it("same game rendered twice (move table + PGN textarea) is one result with headers", () => {
    const games = findGames([
      "1.e4e52.Nf3Nc63.Bb5a64.Ba4Nf65.O-OBe7",
      '[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 *',
    ]);
    expect(games).toHaveLength(1);
    expect(games[0].moves).toHaveLength(12);
    expect(games[0].label).toBe("A \u2013 B (6 moves)");
  });

  it("shorter rendering seen first is replaced by the longer one", () => {
    const games = findGames(["1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6"]);
    expect(games).toHaveLength(1);
    expect(games[0].moves).toHaveLength(8);
  });

  it("identical text twice yields one game", () => {
    expect(findGames([FISCHER_SPASSKY, FISCHER_SPASSKY])).toHaveLength(1);
  });
});

/**
 * Property test: random legal games rendered the way real sites do,
 * must come back move-for-move. Seeded so failures are reproducible.
 */
describe("findGames: round-trips random legal games", () => {
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
      const moves = c.moves();
      if (!moves.length) break;
      c.move(moves[Math.floor(rand() * moves.length)]);
    }
    return c.history();
  }

  const renderers: Record<string, (moves: string[], result: string) => string> = {
    "pgn spaced": (m, r) => m.map((s, i) => (i % 2 ? s : `${i / 2 + 1}. ${s}`)).join(" ") + ` ${r}`,
    "chessgames glued": (m, r) => m.map((s, i) => (i % 2 ? s : `${i / 2 + 1}.${s}`)).join("") + r,
    "lichess glued bare": (m, r) => m.map((s, i) => (i % 2 ? s : `${i / 2 + 1}${s}`)).join("") + r,
    "lichess newline bare": (m, r) => m.map((s, i) => (i % 2 ? s : `${i / 2 + 1}\n${s}`)).join("\n") + `\n${r}`,
    "with black ellipsis": (m, r) =>
      m.map((s, i) => (i % 2 ? `${(i - 1) / 2 + 1}... ${s}` : `${i / 2 + 1}. ${s}`)).join(" ") + ` ${r}`,
  };

  for (const [name, render] of Object.entries(renderers)) {
    it(name, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const moves = randomGame(seed, 20 + (seed % 5) * 40);
        if (moves.length < 6) continue;
        const result = ["1-0", "0-1", "1/2-1/2"][seed % 3];
        const games = findGames([render(moves, result)]);
        expect(games, `seed ${seed}`).toHaveLength(1);
        expect(games[0].moves, `seed ${seed}`).toEqual(moves);
        expect(games[0].headers.Result, `seed ${seed}`).toBe(result);
      }
    });
  }
});

describe("URL builders (Coachess contract v1)", () => {
  const kasparov = one(
    '[White "Kasparov"]\n[Black "Karpov"]\n[Date "1985.10.15"]\n[Result "1/2-1/2"]\n[Event "WCh"]\n\n1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 1/2-1/2',
  );

  it("matches the worked example agreed with Coachess byte for byte", () => {
    expect(coachessGameUrl(kasparov)).toBe(
      "https://coachess.app/coach/position?fen=rnbqkbnr%2Fpppppppp%2F8%2F8%2F8%2F8%2FPPPPPPPP%2FRNBQKBNR%20w%20KQkq%20-%200%201&moves=e4%2Cc5%2CNf3%2Ce6%2Cd4%2Ccxd4%2CNxd4%2CNc6&white=Kasparov&black=Karpov&date=1985.10.15&result=1%2F2-1%2F2&utm_source=fenshot&utm_medium=extension&utm_campaign=game-import",
    );
  });

  it("never sends event= or pgn=", () => {
    const u = new URL(coachessGameUrl(kasparov));
    expect(u.searchParams.has("event")).toBe(false);
    expect(u.searchParams.has("pgn")).toBe(false);
  });

  it("pov=black goes between moves and metadata", () => {
    const u = coachessGameUrl(kasparov, true);
    expect(u).toContain("&moves=e4%2Cc5%2CNf3%2Ce6%2Cd4%2Ccxd4%2CNxd4%2CNc6&pov=black&white=");
  });

  it("omits metadata that is missing or malformed", () => {
    const g = one('[Date "1985.??.??"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    const u = new URL(coachessGameUrl(g));
    for (const k of ["white", "black", "date", "result"]) expect(u.searchParams.has(k)).toBe(false);
    expect(u.searchParams.get("moves")).toBe("e4,e5,Nf3,Nc6,Bb5,a6");
  });

  it("caps the URL at 2000 chars by dropping trailing plies", () => {
    const g: FoundGame = { moves: Array(600).fill("Nf3"), headers: {}, pgn: "", label: "" };
    const u = coachessGameUrl(g);
    expect(u.length).toBeLessThanOrEqual(2000);
    expect(new URL(u).searchParams.get("moves")!.split(",").length).toBeGreaterThan(300);
  });

  it("position handoff keeps the original shape plus UTM", () => {
    expect(coachessPositionUrl("8/8/8/8/8/8/8/K6k w - - 0 1", true)).toBe(
      "https://coachess.app/coach/position?fen=8%2F8%2F8%2F8%2F8%2F8%2F8%2FK6k%20w%20-%20-%200%201&pov=black&utm_source=fenshot&utm_medium=extension&utm_campaign=position",
    );
    expect(coachessPositionUrl("8/8/8/8/8/8/8/K6k w - - 0 1", false)).not.toContain("pov=");
  });

  it("lichess analysis URL uses underscore-joined SAN", () => {
    expect(lichessGameUrl(kasparov)).toBe("https://lichess.org/analysis/pgn/e4_c5_Nf3_e6_d4_cxd4_Nxd4_Nc6");
  });
});
