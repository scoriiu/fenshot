/**
 * Browser-side screenshot recognition. Lazy-loads onnxruntime-web
 * (pure-wasm build) and the tile classifier model on first use.
 *
 * The classifier is trained on a synthetic corpus spanning lichess +
 * chess.com piece sets and board themes, procedural flat boards, and
 * book-diagram hatch boards, with screenshot degradations baked in
 * (dimming, JPEG artifacts, blur, corner jitter).
 *
 * Alignment arbitration: detection corners plus a checkerboard
 * grid-snap candidate are both classified, and the read with higher
 * mean confidence wins. Edge-rich board textures (hatched book
 * diagrams) fool the gradient peak search by a quarter tile; the
 * snap fixes those, but is itself unreliable on dim photo-textured
 * boards, so the classifier arbitrates.
 *
 * recognize: HTMLImageElement/ImageBitmap/File/Blob -> placement FEN
 * + per-tile confidence. reliable=false (minConfidence below
 * CONFIDENCE_FLOOR) means the read is untrustworthy (truly foreign
 * piece set, partial board) and the caller should route the user to
 * an editor with a warning rather than trusting the result.
 */

import {
  boardness,
  findBlurredBoardCandidates,
  findChessboardCorners,
  snapCorners,
  type BoardCorners,
  type GrayImage,
} from "./detect";
import { extractTiles, rgbaToGray } from "./tiles";
import { probsToPlacement, type RecognitionResult } from "./fen";

export const CONFIDENCE_FLOOR = 0.7;

/** Detection works on moderate resolutions; downscale huge retina
 *  screenshots for speed (gradients survive downscaling fine). */
const MAX_DETECT_DIM = 1600;

export interface BoardScanResult extends RecognitionResult {
  corners: BoardCorners;
  reliable: boolean;
  /** True when the read satisfies the one invariant every real chess
   *  position has: exactly one king per side. Detector false positives
   *  on board-free UI (settings pages, card grids) typically read as
   *  sparse kingless scatters; callers doing automatic whole-page scans
   *  should treat implausible reads as "no board found". */
  plausible: boolean;
}

export interface RecognizerOptions {
  /** URL of the tile classifier model (`chess-tiles-v2.onnx`, shipped
   *  in this package under `model/`). Serve it as a static asset and
   *  point here, e.g. "/models/chess-tiles-v2.onnx". */
  modelUrl: string;
  /** Location of the onnxruntime-web wasm assets. Either a directory
   *  URL prefix (e.g. "/ort/") or exact per-file URLs, which is what
   *  bundlers like Vite need:
   *  `{ mjs: mjsUrl, wasm: wasmUrl }` from `?url` imports. */
  wasmPaths: string | { mjs: string; wasm: string };
}

export interface Recognizer {
  /** Scan an image for a chessboard. Resolves null when no board-like
   *  structure is found. */
  recognize(source: HTMLImageElement | ImageBitmap | File | Blob): Promise<BoardScanResult | null>;
  /** Eagerly fetch + compile the wasm runtime and the model so the
   *  first scan is near-instant. Idempotent; failures are swallowed
   *  (a warmup miss just means the first scan pays the cost). */
  warmUp(): void;
}

type OrtModule = typeof import("onnxruntime-web");

function imageToGray(img: HTMLImageElement | ImageBitmap): GrayImage {
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  const scale = Math.min(1, MAX_DETECT_DIM / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch);
  return rgbaToGray(data.data, cw, ch);
}

export type TileClassifier = (corners: BoardCorners) => Promise<RecognitionResult>;

const EMPTY_PLACEMENT = "8/8/8/8/8/8/8/8";

function isPlausiblePosition(placement: string): boolean {
  let white = 0;
  let black = 0;
  for (const ch of placement) {
    if (ch === "K") white++;
    else if (ch === "k") black++;
  }
  return white === 1 && black === 1;
}

/** Detection passes per image: the first board found can be an empty
 *  decorative board (a page can contain several board-like regions,
 *  including this library's own UI); masking it and rescanning finds
 *  the board the user actually means. */
const MAX_SCAN_PASSES = 3;

/** A first-look read this good needs no second look: confident on every
 *  tile, a legal king count, and a box that looks like a board. Normal
 *  chess.com and Lichess screenshots stop here, at the cost they always
 *  had. */
const SETTLED_BOARDNESS = 0.8;

/** Picking the most confident of several alignments flatters the
 *  winner: the maximum of noisy confidences is biased upward, so a wrong
 *  read can clear CONFIDENCE_FLOOR by luck. When another alignment is
 *  nearly as confident (within this margin of the winner's mean) and
 *  reads a DIFFERENT position, the read is contested and not reliable.
 *  Measured on the benchmark and 488 Reddit screenshots: 0.03 removes
 *  every silent misread the second look would otherwise add. */
const CONTEST_MARGIN = 0.03;

interface Read {
  result: RecognitionResult;
  corners: BoardCorners;
}

async function readAll(boxes: BoardCorners[], classify: TileClassifier): Promise<Read[]> {
  const reads: Read[] = [];
  for (const corners of boxes) reads.push({ result: await classify(corners), corners });
  return reads;
}

/** Highest mean confidence; the earlier box wins a tie. */
function mostConfident(reads: Read[]): Read | null {
  let best: Read | null = null;
  for (const r of reads) {
    if (!best || r.result.meanConfidence > best.result.meanConfidence) best = r;
  }
  return best;
}

function firstLookBoxes(gray: GrayImage): BoardCorners[] {
  const corners = findChessboardCorners(gray);
  if (!corners) return [];
  const snapped = snapCorners(gray, corners);
  const same =
    snapped.x0 === corners.x0 && snapped.y0 === corners.y0 && snapped.x1 === corners.x1 && snapped.y1 === corners.y1;
  return same ? [corners] : [corners, snapped];
}

function toScan(read: Read, reliable: boolean): BoardScanResult {
  return {
    ...read.result,
    corners: read.corners,
    reliable,
    plausible: isPlausiblePosition(read.result.placement),
  };
}

async function scanOnce(
  gray: GrayImage,
  classify: TileClassifier,
): Promise<BoardScanResult | null> {
  const boxes = firstLookBoxes(gray);
  const reads = await readAll(boxes, classify);
  const first = mostConfident(reads);
  if (
    first &&
    first.result.minConfidence >= CONFIDENCE_FLOOR &&
    isPlausiblePosition(first.result.placement) &&
    boardness(gray, first.corners) >= SETTLED_BOARDNESS
  ) {
    return toScan(first, true);
  }
  reads.push(...(await readAll(findBlurredBoardCandidates(gray, boxes), classify)));
  const best = mostConfident(reads);
  if (!best) return null;
  const contested = reads.some(
    (r) =>
      r.result.placement !== best.result.placement &&
      r.result.meanConfidence >= best.result.meanConfidence - CONTEST_MARGIN,
  );
  return toScan(best, best.result.minConfidence >= CONFIDENCE_FLOOR && !contested);
}

/** Flatten a region so its gradients vanish and the detector cannot
 *  lock onto it again on the next pass. */
function maskRegion(gray: GrayImage, box: BoardCorners): GrayImage {
  const data = Float32Array.from(gray.data);
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(gray.width, Math.ceil(box.x1));
  const y1 = Math.min(gray.height, Math.ceil(box.y1));
  for (let y = y0; y < y1; y++) {
    data.fill(128, y * gray.width + x0, y * gray.width + x1);
  }
  return { data, width: gray.width, height: gray.height };
}

/**
 * Pure recognition core: detect corners, classify, arbitrate against
 * the grid-snap candidate. Platform-independent (no canvas, no ONNX);
 * the classifier is injected. Exercised directly by the golden test
 * suite and usable from Node with any rasterizer.
 *
 * An implausible read is unlikely to be the board the user means: an
 * empty board has no position to analyze, and a kingless scatter is
 * usually the detector locking onto board-free UI (whole-screen
 * captures can include decorative boards, placeholder boards, and
 * card grids that look like boards). When a pass reads implausible,
 * the region is masked and the scan repeats, preferring a plausible
 * board found later. The best implausible read is still returned when
 * nothing better exists, preferring piece-bearing reads over empty
 * ones; callers decide how much to trust it via `plausible`.
 */
export async function recognizeGray(
  gray: GrayImage,
  classify: TileClassifier,
): Promise<BoardScanResult | null> {
  let working = gray;
  let fallback: BoardScanResult | null = null;
  for (let pass = 0; pass < MAX_SCAN_PASSES; pass++) {
    const result = await scanOnce(working, classify);
    if (!result) break;
    if (result.plausible) return result;
    const fallbackIsEmpty = !fallback || fallback.placement === EMPTY_PLACEMENT;
    if (fallbackIsEmpty && (!fallback || result.placement !== EMPTY_PLACEMENT)) {
      fallback = result;
    }
    working = maskRegion(working, result.corners);
  }
  return fallback;
}

export function createRecognizer(options: RecognizerOptions): Recognizer {
  let ortPromise: Promise<OrtModule> | null = null;
  let sessionPromise: Promise<import("onnxruntime-web").InferenceSession> | null = null;

  function loadOrt(): Promise<OrtModule> {
    if (!ortPromise) {
      // The pure-wasm build: the default package entry is the JSEP
      // (webgpu) bundle which requests ort-wasm-*.jsep.mjs at runtime;
      // only the plain wasm pair is required here.
      ortPromise = import("onnxruntime-web/wasm").then((ort) => {
        ort.env.wasm.wasmPaths = options.wasmPaths;
        return ort as unknown as OrtModule;
      });
    }
    return ortPromise;
  }

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const ort = await loadOrt();
        return ort.InferenceSession.create(options.modelUrl, {
          executionProviders: ["wasm"],
        });
      })();
    }
    return sessionPromise;
  }

  return {
    warmUp() {
      void getSession().catch(() => undefined);
    },

    async recognize(source) {
      const img =
        source instanceof File || source instanceof Blob ? await createImageBitmap(source) : source;
      const gray = imageToGray(img);
      const [ort, session] = await Promise.all([loadOrt(), getSession()]);

      return recognizeGray(gray, async (c) => {
        const tiles = extractTiles(gray, c);
        const out = await session.run({ tiles: new ort.Tensor("float32", tiles, [64, 1024]) });
        return probsToPlacement(out["probs"].data as Float32Array);
      });
    },
  };
}
