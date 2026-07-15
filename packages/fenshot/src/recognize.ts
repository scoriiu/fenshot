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

import { findChessboardCorners, snapCorners, type BoardCorners, type GrayImage } from "./detect";
import { extractTiles, rgbaToGray } from "./tiles";
import { probsToPlacement, type RecognitionResult } from "./fen";

export const CONFIDENCE_FLOOR = 0.7;

/** Detection works on moderate resolutions; downscale huge retina
 *  screenshots for speed (gradients survive downscaling fine). */
const MAX_DETECT_DIM = 1600;

export interface BoardScanResult extends RecognitionResult {
  corners: BoardCorners;
  reliable: boolean;
}

export interface RecognizerOptions {
  /** URL of the tile classifier model (`chess-tiles-v2.onnx`, shipped
   *  in this package under `model/`). Serve it as a static asset and
   *  point here, e.g. "/models/chess-tiles-v2.onnx". */
  modelUrl: string;
  /** Directory URL of the onnxruntime-web wasm assets
   *  (`ort-wasm-simd-threaded.{mjs,wasm}`), e.g. "/ort/". */
  wasmPaths: string;
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
      const corners = findChessboardCorners(gray);
      if (!corners) return null;
      const [ort, session] = await Promise.all([loadOrt(), getSession()]);

      const classify = async (c: BoardCorners): Promise<RecognitionResult> => {
        const tiles = extractTiles(gray, c);
        const out = await session.run({ tiles: new ort.Tensor("float32", tiles, [64, 1024]) });
        return probsToPlacement(out["probs"].data as Float32Array);
      };

      let bestCorners = corners;
      let best = await classify(corners);
      const snapped = snapCorners(gray, corners);
      if (
        snapped.x0 !== corners.x0 ||
        snapped.y0 !== corners.y0 ||
        snapped.x1 !== corners.x1 ||
        snapped.y1 !== corners.y1
      ) {
        const snappedRead = await classify(snapped);
        if (snappedRead.meanConfidence > best.meanConfidence) {
          best = snappedRead;
          bestCorners = snapped;
        }
      }
      return {
        ...best,
        corners: bestCorners,
        reliable: best.minConfidence >= CONFIDENCE_FLOOR,
      };
    },
  };
}
