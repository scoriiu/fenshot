# Tile Classifier Training

Training pipeline for fenshot's tile classifier
(`packages/fenshot/model/chess-tiles-v2.onnx`). Replaces the legacy
tensorflow_chessbot model, which was trained on a narrow set of themes
and failed on foreign piece sets (queen/king confusions on chess.com
themes, useless on book diagrams).

## Why synthetic data

Labeled data is free: render a known position, and every tile's label
is known by construction. The whole game is making renders look like
real screenshots. Tiles are extracted through the package's own
`rgbaToGray` + `extractBoardImage` + `boardToTiles` so there is zero
train/serve skew.

## Pipeline

1. **`download-assets.ts`** - pulls piece sets + board textures into
   `.tmp/scan-assets/` (gitignored). Sources: lichess lila repo (free),
   chess.com CDN (training input only, never redistributed; only the
   trained weights ship). ~72 complete piece sets, ~55 board textures.
   Pruned: `mono`/`monarchy`/`disguised` (different file scheme),
   `blindfold` (invisible pieces), `3d_*` (perspective overhang our
   flat compositor would misrepresent - v2 candidate).

2. **`generate-corpus.ts`** - renders boards and extracts labeled tiles.

   ```
   npx tsx tools/tile-classifier/generate-corpus.ts --boards 12000
   npx tsx tools/tile-classifier/generate-corpus.ts --boards 6000 --procedural --out .tmp/scan-corpus-proc --seed 1337
   ```

   - Positions: 50% random chess.js playouts (realistic), 50% uniform
     random placements (class balance for rare pieces; tile classifiers
     don't care about legality).
   - `--procedural`: flat two-color boards with random color pairs
     (generalizes to ANY site's flat theme) + hatched book-diagram
     boards (chess books / PDFs, biased toward print-style piece sets).
   - Decorations: last-move highlights, arrows, coordinate labels.
   - Degradations: dimming overlays (Reddit lightbox case), JPEG
     artifacts q35-95, blur, resize round-trips, corner jitter ±3px
     (simulates detector imprecision).
   - Output: shards of u8 tiles (64x1024 per board) + 64-char label
     lines, order matches `boardToTiles` (A1..H8 by rank).

3. **`train.py`** - small CNN (~330k params, 1.3MB fp32 ONNX vs legacy
   4.3MB), 8 epochs on MPS.

   ```
   CORPUS=.tmp/scan-corpus:.tmp/scan-corpus-proc .tmp/venv-img2pos/bin/python tools/tile-classifier/train.py
   ```

   Exports `.tmp/tile-model/tilenet.onnx`: input `tiles` [N,1024]
   float 0..1, output `probs` [N,13] softmax, class order
   `1KQRBNPkqrbnp` (matches `packages/fenshot/src/fen.ts`).

4. **`eval-real.ts`** - acceptance gate: the REAL production pipeline
   (`recognizeGray`: detect -> arbitrate -> classify, including the
   empty-board rescan) on real screenshots with known FENs.

   ```
   npx tsx tools/tile-classifier/eval-real.ts                                             # new model
   npx tsx tools/tile-classifier/eval-real.ts --model packages/fenshot/model/chess-tiles-v2.onnx  # shipping baseline
   ```

   Legacy tensorflow_chessbot baseline (2026-06-12): chesscom/lichess
   fixtures pass, fen2image 34 wrong tiles, reddit screenshot 5 wrong
   tiles @ 0.436.

## Shipping a new model

1. Eval gate passes: 0 wrong tiles on all positive cases, negative
   still rejected, minConf comfortably above `CONFIDENCE_FLOOR` (0.7).
2. Copy to `packages/fenshot/model/` (keep the filename versioned:
   bump to `chess-tiles-v3.onnx` and update `modelUrl` consumers).
3. `npm test` (the golden suite runs the model end to end) and flip
   manifest expectations that the new model upgrades.
4. Publish a new package version. Downstream apps (coachess) pick the
   model up through their prebuild copy from `node_modules`.
