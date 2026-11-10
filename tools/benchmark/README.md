# fenshot accuracy benchmark

How often fenshot reads a chess image exactly right, on images where the
right answer is known and that fenshot did not draw. Results are published at
https://fenshot.com/accuracy/.

## What is in here

| File | What it is |
|------|------------|
| `positions.json` | 240 Lichess puzzle positions (80 opening, 80 middlegame, 80 endgame), picked by a fixed rule |
| `cases.json` | Every drawn image: source URL or capture recipe, true placement, sha256 |
| `results.json` | The score of every image in `cases.json`, plus the summary |
| `reddit-results.json` | The Reddit set: post, image URL, sha256, the bot's reading, fenshot's reading, outcome |
| `history.json` | The summary of every published run, oldest first: the "What changed" table on the page |
| `build.ts` | Rebuilds the images (chess.com board images, chess.com and Lichess page screenshots, pages with no board) |
| `build-books.py` | Typesets the book diagrams with LaTeX (needs pdflatex with the chessboard, skak and skaknew packages, and pdftoppm) |
| `diagnose.ts` | For each failing case: was the board located wrong, or were the pieces read wrong? |
| `run.ts` | Scores the shipping recognizer and model on the images |
| `publish.mjs` | Writes the numbers into `apps/web/public/accuracy/index.html` and `llms.txt` |
| `reddit-*.{mjs,ts,py}` | Collects the Reddit set, crops boards for the eye check, finalizes `reddit-results.json` |

Images are not committed: the artwork belongs to chess.com, Lichess and the
Reddit posters. The recipes and fingerprints let anyone rebuild the same set.

## Re-run

```
npx tsx tools/benchmark/build.ts      # images -> .tmp/benchmark/images, cases.json
python3 tools/benchmark/build-books.py   # the book diagrams, merged into cases.json
npx tsx tools/benchmark/run.ts        # results.json
node tools/benchmark/publish.mjs      # page + llms.txt numbers (add the run to history.json first)
```

The Reddit set:

```
node tools/benchmark/reddit-collect.mjs --posts 2000
python3 tools/benchmark/reddit-cases.py
npx tsx tools/benchmark/run.ts --cases .tmp/benchmark/reddit/cases-provisional.json \
  --images .tmp/benchmark/reddit --out .tmp/benchmark/reddit/results-provisional.json
npx tsx tools/benchmark/reddit-dump.ts
python3 tools/benchmark/reddit-finalize.py
```

## Outcomes

- **exact**: all 64 squares right, no warning.
- **exact-warned**: all squares right, but the user is told to check. A warning is what the apps show: the low-confidence warning, or the "not a legal position, fix it in the editor" warning (chess.js rejects the position).
- **wrong-warned**: a square is wrong, and the user is told to check (the editor opens).
- **wrong-silent**: a square is wrong with no warning. The failure that matters.
- **missed**: no board found.
- No-board pages: **rejected** (no board, or an impossible read the extension discards), **warned**, or **false-board**.

## Rules that keep it honest

- No image is drawn by fenshot's own drawing code. Site boards are drawn by the
  sites; book diagrams are typeset by LaTeX. chess.com pages are checked to show
  the requested position before they are kept.
- A change to the recognizer ships only if nothing that was right becomes wrong
  on the benchmark, and the Reddit set is scored before and after as well.
- Positions are picked by rule, never by hand, and never re-picked after scoring.
- Reddit truth: where fenshot and the chessvision-ai-bot agree, the read counts
  as right (18 random agreements were compared to the image by eye: no mismatch).
  Every disagreement counts against fenshot, even where fenshot was right, so
  the Reddit number is a floor. The set only contains images the bot answered.
- Never train on these positions or images. A model trained on them makes the
  benchmark meaningless.
- When a number gets worse, publish it anyway and fix the weak spot.
