import { describe, it, expect } from "vitest";
import { inferCastling, placementToFen } from "../src/compose";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

describe("inferCastling", () => {
  it("grants all rights on the start position", () => {
    expect(inferCastling(START)).toBe("KQkq");
  });

  it("drops rights when a rook left home", () => {
    expect(inferCastling("rnbqkbn1/pppppppp/7r/8/8/8/PPPPPPPP/RNBQKBNR")).toBe("KQq");
  });

  it("drops both rights when the king left home", () => {
    expect(inferCastling("rnbq1bnr/ppppkppp/8/8/8/8/PPPPKPPP/RNBQ1BNR")).toBe("-");
  });

  it("returns dash on malformed placement", () => {
    expect(inferCastling("8/8/8")).toBe("-");
  });

  it("handles castled positions (no phantom rights)", () => {
    expect(inferCastling("r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1")).toBe("-");
  });
});

describe("placementToFen", () => {
  it("composes a full six-field FEN", () => {
    expect(placementToFen(START, "w")).toBe(`${START} w KQkq - 0 1`);
  });

  it("respects side to move and inferred castling", () => {
    const noCastle = "rnbq1bnr/ppppkppp/8/8/8/8/PPPPKPPP/RNBQ1BNR";
    expect(placementToFen(noCastle, "b")).toBe(`${noCastle} b - - 0 1`);
  });
});
