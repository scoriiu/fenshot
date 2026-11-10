import { describe, expect, it } from "vitest";
import { sideOfBoard, type PageBoard } from "../../src/board-side";

const board = (x0: number, y0: number, x1: number, y1: number, side: "white" | "black"): PageBoard => ({ x0, y0, x1, y1, side });

describe("sideOfBoard", () => {
  it("takes the side of the page board the read sits on", () => {
    const boards = [board(0.26, 0.07, 0.75, 0.85, "black")];
    expect(sideOfBoard({ x0: 0.265, y0: 0.075, x1: 0.748, y1: 0.848 }, boards)).toBe("black");
  });

  it("returns null when the read is somewhere else on the page", () => {
    const boards = [board(0.26, 0.07, 0.75, 0.85, "black")];
    expect(sideOfBoard({ x0: 0.8, y0: 0.1, x1: 0.95, y1: 0.35 }, boards)).toBeNull();
  });

  it("does not accept a board that only partly overlaps the read", () => {
    const boards = [board(0.1, 0.1, 0.5, 0.7, "black")];
    expect(sideOfBoard({ x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.7 }, boards)).toBeNull();
  });

  it("picks the best match among several boards", () => {
    const boards = [board(0.05, 0.1, 0.25, 0.42, "white"), board(0.3, 0.1, 0.7, 0.75, "black")];
    expect(sideOfBoard({ x0: 0.31, y0: 0.11, x1: 0.69, y1: 0.74 }, boards)).toBe("black");
    expect(sideOfBoard({ x0: 0.05, y0: 0.1, x1: 0.25, y1: 0.42 }, boards)).toBe("white");
  });

  it("returns null when the page describes no board", () => {
    expect(sideOfBoard({ x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.8 }, [])).toBeNull();
  });
});
