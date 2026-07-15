import { describe, it, expect } from "vitest";
import { probsToPlacement } from "../src/fen";
import { rgbaToGray, extractTiles, TILE_INPUT_SIZE } from "../src/tiles";
import { findChessboardCorners } from "../src/detect";
import { recognizeGray } from "../src/recognize";

/** Build a [64,13] probability tensor: every square empty (class 0)
 *  at the given confidence, with optional piece overrides keyed by
 *  tile index (A1=0 .. H8=63). */
function probsFor(overrides: Record<number, { cls: number; p: number }>, emptyP = 1.0): Float32Array {
  const probs = new Float32Array(64 * 13);
  for (let i = 0; i < 64; i++) {
    const o = overrides[i];
    if (o) {
      probs[i * 13 + o.cls] = o.p;
    } else {
      probs[i * 13] = emptyP;
    }
  }
  return probs;
}

// class order: 1KQRBNPkqrbnp
const K = 1;
const k = 7;

describe("probsToPlacement", () => {
  it("reads an empty board", () => {
    const r = probsToPlacement(probsFor({}));
    expect(r.placement).toBe("8/8/8/8/8/8/8/8");
    expect(r.minConfidence).toBe(1);
    expect(r.meanConfidence).toBe(1);
  });

  it("places pieces at the right squares (A1 tile order, ranks 8..1 output)", () => {
    // e1 = rank 0, file 4 = tile 4; e8 = rank 7, file 4 = tile 60
    const r = probsToPlacement(probsFor({ 4: { cls: K, p: 0.95 }, 60: { cls: k, p: 0.9 } }));
    expect(r.placement).toBe("4k3/8/8/8/8/8/8/4K3");
    expect(r.minConfidence).toBeCloseTo(0.9, 5);
  });

  it("min and mean confidence reflect the weakest tile", () => {
    const r = probsToPlacement(probsFor({ 0: { cls: K, p: 0.4 } }, 0.8));
    expect(r.minConfidence).toBeCloseTo(0.4, 5);
    expect(r.meanConfidence).toBeCloseTo((0.4 + 63 * 0.8) / 64, 5);
  });
});

describe("rgbaToGray", () => {
  it("applies ITU-R 601 luma", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const g = rgbaToGray(rgba, 4, 1);
    expect(g.data[0]).toBeCloseTo(0.299 * 255, 3);
    expect(g.data[1]).toBeCloseTo(0.587 * 255, 3);
    expect(g.data[2]).toBeCloseTo(0.114 * 255, 3);
    expect(g.data[3]).toBeCloseTo(255, 3);
  });
});

describe("extractTiles shape and range", () => {
  it("emits [64,1024] normalized to 0..1 even with out-of-bounds corners", () => {
    const img = { data: new Float32Array(100 * 100).fill(128), width: 100, height: 100 };
    const tiles = extractTiles(img, { x0: -10, y0: -10, x1: 110, y1: 110 });
    expect(tiles.length).toBe(64 * TILE_INPUT_SIZE);
    for (let i = 0; i < tiles.length; i += 997) {
      expect(tiles[i]).toBeGreaterThanOrEqual(0);
      expect(tiles[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe("detector edge cases", () => {
  it("returns null on a uniform image", () => {
    const img = { data: new Float32Array(400 * 400).fill(90), width: 400, height: 400 };
    expect(findChessboardCorners(img)).toBeNull();
  });

  it("returns null on a tiny image without throwing", () => {
    const img = { data: new Float32Array(16 * 16).fill(0), width: 16, height: 16 };
    expect(findChessboardCorners(img)).toBeNull();
  });
});

describe("recognizeGray", () => {
  it("propagates null when no board is detected, without calling the classifier", async () => {
    const img = { data: new Float32Array(200 * 200).fill(50), width: 200, height: 200 };
    let calls = 0;
    const result = await recognizeGray(img, async () => {
      calls++;
      return probsToPlacement(probsFor({}));
    });
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});
