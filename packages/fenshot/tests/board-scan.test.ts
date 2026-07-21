/**
 * Board-scan port regression tests.
 *
 * Goldens were produced by the python reference pipeline
 * (Elucidation/tensorflow_chessbot, MIT) and validated against the
 * repo's published expected FEN. The TS port must reproduce:
 *   1. detector corners on the reference image (exact),
 *   2. tile tensors (close to the PIL-bilinear goldens),
 *   3. end-to-end FEN on real screenshots (chess.com, lichess, book
 *      diagram, dimmed reddit page) via the v2 ONNX model under
 *      onnxruntime-web, with snap-candidate arbitration mirroring
 *      recognize.ts (exact),
 *   4. null corners on board-free page chrome.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PNG } from "pngjs";
import * as ort from "onnxruntime-web";
import { findChessboardCorners, type GrayImage } from "../src/detect";
import { extractTiles, rgbaToGray } from "../src/tiles";
import { recognizeGray } from "../src/recognize";
import { probsToPlacement, flipPlacement, resolveOrientation } from "../src/fen";

const FIX = join(__dirname, "fixtures");

function loadGoldenGray(): GrayImage {
  const meta = JSON.parse(readFileSync(join(FIX, "example-meta.json"), "utf8"));
  const bytes = readFileSync(join(FIX, "example-gray.u8.bin"));
  const data = new Float32Array(meta.width * meta.height);
  for (let i = 0; i < data.length; i++) data[i] = bytes[i];
  return { data, width: meta.width, height: meta.height };
}

function loadPngGray(name: string): GrayImage {
  const png = PNG.sync.read(readFileSync(join(FIX, name)));
  return rgbaToGray(new Uint8ClampedArray(png.data), png.width, png.height);
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    const model = readFileSync(join(__dirname, "..", "model", "chess-tiles-v2.onnx"));
    sessionPromise = ort.InferenceSession.create(
      model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength) as ArrayBuffer,
      { executionProviders: ["wasm"] },
    );
  }
  return sessionPromise;
}

async function classify(img: GrayImage, corners: NonNullable<ReturnType<typeof findChessboardCorners>>) {
  const tiles = extractTiles(img, corners);
  const session = await getSession();
  const out = await session.run({ tiles: new ort.Tensor("float32", tiles, [64, 1024]) });
  return probsToPlacement(out["probs"].data as Float32Array);
}

/** Runs the REAL arbitration core (recognizeGray) with the real model. */
async function recognize(img: GrayImage) {
  const result = await recognizeGray(img, (c) => classify(img, c));
  expect(result).not.toBeNull();
  return result!;
}

describe("board-scan detector port", () => {
  it("reproduces the reference corners on the golden image", () => {
    const meta = JSON.parse(readFileSync(join(FIX, "example-meta.json"), "utf8"));
    const corners = findChessboardCorners(loadGoldenGray());
    expect(corners).not.toBeNull();
    const [x0, y0, x1, y1] = meta.corners;
    expect(Math.abs(corners!.x0 - x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(corners!.y0 - y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(corners!.x1 - x1)).toBeLessThanOrEqual(2);
    expect(Math.abs(corners!.y1 - y1)).toBeLessThanOrEqual(2);
  });

  it("produces tiles close to the PIL-bilinear goldens", () => {
    const meta = JSON.parse(readFileSync(join(FIX, "example-meta.json"), "utf8"));
    const [x0, y0, x1, y1] = meta.corners;
    const tiles = extractTiles(loadGoldenGray(), { x0, y0, x1, y1 });
    const golden = new Float32Array(readFileSync(join(FIX, "example-tiles.f32.bin")).buffer.slice(0));
    expect(tiles.length).toBe(golden.length);
    let maxDiff = 0;
    let sumDiff = 0;
    for (let i = 0; i < tiles.length; i++) {
      const d = Math.abs(tiles[i] - golden[i]);
      if (d > maxDiff) maxDiff = d;
      sumDiff += d;
    }
    expect(sumDiff / tiles.length).toBeLessThan(0.01);
    expect(maxDiff).toBeLessThan(0.25);
  });

  it("recognizes the golden image end to end", async () => {
    const meta = JSON.parse(readFileSync(join(FIX, "example-meta.json"), "utf8"));
    const result = await recognize(loadGoldenGray());
    expect(result.placement).toBe(meta.expectedFen);
    // The image has a thick gray move arrow through f5; the tile
    // still classifies correctly but caps min confidence. The product
    // gate is CONFIDENCE_FLOOR (0.7) on min, with a strong mean.
    expect(result.minConfidence).toBeGreaterThan(0.7);
    expect(result.meanConfidence).toBeGreaterThan(0.9);
    expect(result.plausible).toBe(true);
  });
});

describe("plausibility gating (kingless false positives)", () => {
  // Regression: on brave://extensions/ the detector locked onto the
  // settings-page card grid and the classifier hallucinated a sparse
  // kingless scatter. Such reads must come back plausible=false and
  // must not shadow a real board found on a later masked pass.
  const stubResult = (placement: string) => ({
    placement,
    confidences: new Array(64).fill(0.95),
    minConfidence: 0.95,
    meanConfidence: 0.95,
  });

  it("returns a kingless read as fallback flagged implausible", async () => {
    const result = await recognizeGray(loadGoldenGray(), async () =>
      stubResult("3p4/8/8/3qBB1p/8/8/8/8"),
    );
    expect(result).not.toBeNull();
    expect(result!.plausible).toBe(false);
  });

  it("returns a two-king read immediately as plausible", async () => {
    const result = await recognizeGray(loadGoldenGray(), async () =>
      stubResult("4k3/8/8/8/8/8/8/4K3"),
    );
    expect(result).not.toBeNull();
    expect(result!.plausible).toBe(true);
  });

  it("masks an implausible region and keeps scanning for a real board", async () => {
    // Two golden boards side by side; the left one reads as a kingless
    // scatter (false positive), the right one as a real position. The
    // scan must not stop at the kingless read.
    const g = loadGoldenGray();
    const w = g.width * 2;
    const data = new Float32Array(w * g.height);
    for (let y = 0; y < g.height; y++) {
      const row = g.data.subarray(y * g.width, (y + 1) * g.width);
      data.set(row, y * w);
      data.set(row, y * w + g.width);
    }
    const img = { data, width: w, height: g.height };
    const result = await recognizeGray(img, async (c) =>
      stubResult(c.x0 < g.width ? "3p4/8/8/3qBB1p/8/8/8/8" : "4k3/8/8/8/8/8/8/4K3"),
    );
    expect(result).not.toBeNull();
    expect(result!.placement).toBe("4k3/8/8/8/8/8/8/4K3");
    expect(result!.plausible).toBe(true);
  });
});

describe("board-scan rejects board-free images", () => {
  it("returns null corners on page chrome with no board", () => {
    expect(findChessboardCorners(loadPngGray("reddit-chrome-no-board.png"))).toBeNull();
  });
});

describe("board-scan on real screenshots", () => {
  const manifest = JSON.parse(readFileSync(join(FIX, "testset-manifest.json"), "utf8")) as Record<
    string,
    { fen: string; orientation: "white" | "black"; expect: "match" | "low-confidence-reject" }
  >;

  for (const [file, spec] of Object.entries(manifest)) {
    it(`${file} -> ${spec.expect}`, async () => {
      const result = await recognize(loadPngGray(file));
      if (spec.expect === "match") {
        const placement = spec.orientation === "black" ? flipPlacement(result.placement) : result.placement;
        expect(placement).toBe(spec.fen);
        expect(result.minConfidence).toBeGreaterThan(0.7);
      } else {
        expect(result.minConfidence).toBeLessThan(0.7);
      }
    });
  }
});

describe("flipPlacement", () => {
  it("is an involution and mirrors the start position correctly", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    expect(flipPlacement(flipPlacement(start))).toBe(start);
    expect(flipPlacement(start)).toBe("RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr");
  });
});

describe("resolveOrientation", () => {
  // The recognizer always reads tiles white-at-bottom. resolveOrientation
  // keys on pawn-advance direction: white pawns sit on lower ranks than
  // black pawns in any natural position; a Black-POV screenshot inverts
  // that, so the read is flipped to recover the true orientation.
  it("keeps a normal white-bottom read as white", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    const r = resolveOrientation(start);
    expect(r.orientation).toBe("white");
    expect(r.placement).toBe(start);
  });

  it("keeps a midgame read white when pawns advance naturally", () => {
    const mid = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R";
    expect(resolveOrientation(mid).orientation).toBe("white");
  });

  it("flips to black when a Black-POV screenshot inverts pawn direction", () => {
    // Black-POV read of an endgame: white pawns appear high (ranks 6-7),
    // black pawns low (ranks 2-3), which only happens on a flipped board.
    const blackPovRead = "2K2R2/1P5P/1bPr2P1/4p3/8/7N/pp6/1k6";
    const r = resolveOrientation(blackPovRead);
    expect(r.orientation).toBe("black");
    expect(r.placement).toBe(flipPlacement(blackPovRead));
  });

  it("defaults to white when the signal is absent (no pawns)", () => {
    const noPawns = "4k3/8/8/8/8/8/8/4K3";
    expect(resolveOrientation(noPawns).orientation).toBe("white");
  });
});
