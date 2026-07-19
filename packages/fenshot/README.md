# fenshot

Screenshot in. FEN out.

[![CI](https://github.com/scoriiu/fenshot/actions/workflows/ci.yml/badge.svg)](https://github.com/scoriiu/fenshot/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40scoriiu%2Ffenshot)](https://www.npmjs.com/package/@scoriiu/fenshot)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/scoriiu/fenshot/blob/main/LICENSE)

Live demo: **[fenshot.com](https://fenshot.com/)**

Chessboard recognition that runs entirely in the browser: finds the board in any screenshot (chess.com, Lichess, book diagrams, reddit lightboxes), reads the position with a CNN tile classifier, and returns a FEN with per-tile confidence. No server, no account, nothing leaves the page.

Extracted from the position-import feature of [coachess.app](https://coachess.app?ref=fenshot-npm), where it runs in production.

## Install

```bash
npm install @scoriiu/fenshot onnxruntime-web
```

Two static assets must be served by your app:

1. **The model** (1.3 MB): copy `node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx` to your static dir.
2. **The onnxruntime wasm pair**: copy `ort-wasm-simd-threaded.mjs` and `ort-wasm-simd-threaded.wasm` from `node_modules/onnxruntime-web/dist/` to a static dir (e.g. `/ort/`).

Both are lazy-loaded on first scan, so users who never scan never download them.

## Quickstart

```ts
import { createRecognizer, resolveOrientation, placementToFen } from "@scoriiu/fenshot";

const recognizer = createRecognizer({
  modelUrl: "/models/chess-tiles-v2.onnx",
  wasmPaths: "/ort/",
});

// e.g. from a paste event, drag-drop, or <input type="file">
const result = await recognizer.recognize(file);

if (!result) {
  // no board-like structure found in the image
} else if (!result.reliable) {
  // board found but the read is untrustworthy (foreign piece set,
  // partial board): show an editor, not a wrong answer
} else {
  const { placement, orientation } = resolveOrientation(result.placement);
  const fen = placementToFen(placement, "w");
  window.open(`https://lichess.org/analysis/standard/${fen.replaceAll(" ", "_")}`);
}
```

## API

### `createRecognizer(options): Recognizer`

- `options.modelUrl` — URL of the served ONNX model.
- `options.wasmPaths` — directory URL of the onnxruntime wasm assets.

### `recognizer.recognize(source): Promise<BoardScanResult | null>`

`source` is an `HTMLImageElement`, `ImageBitmap`, `File`, or `Blob`. Resolves `null` when no chessboard is detected. Otherwise:

```ts
interface BoardScanResult {
  placement: string;      // FEN board field, always read white-at-bottom
  meanConfidence: number; // mean per-tile classifier confidence
  minConfidence: number;  // worst tile
  reliable: boolean;      // minConfidence >= 0.7; if false, route to an editor
  corners: BoardCorners;  // board bounding box in image coordinates
}
```

### `recognizer.warmUp(): void`

Eagerly fetches and compiles the wasm runtime + model so the first scan is near-instant. Call it on scan intent (upload hover, textarea focus). Idempotent.

### `resolveOrientation(placement)`

The recognizer always reads tiles white-at-bottom. If the screenshot was from Black's point of view, pawn-advance direction gives it away; this returns the corrected placement and detected orientation.

### `placementToFen(placement, turn)` / `inferCastling(placement)`

Compose a full analyzable FEN from a bare placement. Castling rights are inferred from king/rook home squares (a screenshot carries no history); en passant and move counters get neutral defaults.

### Lower-level pieces

`findChessboardCorners`, `snapCorners`, `extractTiles`, `rgbaToGray`, `probsToPlacement`, `flipPlacement` are all exported for custom pipelines (e.g. Node with a raster library instead of canvas).

## How it works, and why it reads book diagrams

1. **Detection** is a TypeScript port of `chessboard_finder.py` from [Elucidation/tensorflow_chessbot](https://github.com/Elucidation/tensorflow_chessbot) (MIT): board edges produce evenly spaced gradient peaks; find the 7-line arithmetic sequence, pick the sub-grid that best matches an ideal checkerboard. One measured deviation: the reference's scale-dependent noise pre-gate is removed, it rejected page-wide screenshots whose board spans a small part of the frame, and against our fixture corpus it rejected nothing the sequence search did not already reject.
2. **Classification** is a from-scratch CNN (~330k params, 1.3 MB) trained on a fully synthetic corpus: known positions rendered across ~72 piece sets and ~55 board themes, plus procedural flat boards (any site's theme) and hatched book-diagram boards, with screenshot degradations baked in (JPEG artifacts q35-95, blur, dimming overlays, resize round-trips, corner jitter). Every tile's label is true by construction, and training tiles flow through the exact same extraction code that runs in the browser, so there is zero train/serve skew.
3. **Arbitration**: edge-rich board textures fool the gradient search by a quarter tile, so both the detected corners and a checkerboard grid-snap candidate are classified, and the read with higher mean confidence wins.
4. **Honesty**: `reliable: false` when any tile's confidence is below 0.7. A scanner that silently returns its best guess on a foreign piece set is worse than one that tells you to check.

Versus the legacy tensorflow_chessbot model on our real-screenshot eval set: the legacy model misread 34 tiles on one fixture and 5 tiles on a dimmed reddit screenshot; this model ships at zero wrong tiles on all positive cases with negatives still rejected.

The model is reproducible, not just downloadable: the full training pipeline (asset fetcher, corpus generator, training script, and an eval gate that runs the real recognition pipeline against the golden fixtures) lives in [`tools/tile-classifier`](https://github.com/scoriiu/fenshot/tree/main/tools/tile-classifier).

## Limitations

- 2D screenshots and diagrams only. 3D piece sets with perspective overhang are out of scope for now.
- Browser-first: `recognize()` uses canvas + `createImageBitmap`. In Node, use the lower-level exports with your own rasterizer.
- The board must be roughly axis-aligned (screenshots are; photos of physical boards at an angle are not this tool).

## Credits

- Board detection algorithm: [Elucidation/tensorflow_chessbot](https://github.com/Elucidation/tensorflow_chessbot) (MIT).
- Piece set and board theme assets used as training input: lichess ([lila](https://github.com/lichess-org/lila), free licenses). The corpus also includes other sites' themes (including chess.com) so the recognizer reads their screenshots too; those assets are training input only and are never redistributed, only trained weights ship.
- Built and maintained by [coachess.app](https://coachess.app?ref=fenshot-npm).

## License

MIT
