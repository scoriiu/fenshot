# fenshot

Screenshot in. FEN out.

Paste any chessboard screenshot, a chess.com game, a Lichess puzzle, a diagram from a chess book PDF, a position someone posted on reddit, and get the position as a FEN you can analyze, entirely in your browser. Nothing is uploaded anywhere.

- **[Live demo](https://coriiusolomon.github.io/fenshot/)** — paste an image, get the position, one click to analyze on Lichess.
- **[`fenshot` on npm](https://www.npmjs.com/package/fenshot)** — the recognition engine as a library ([docs](packages/fenshot/README.md)).

## Why another scanner

There was no maintained, high-quality, open-source screenshot scanner. The classic OSS reference (tensorflow_chessbot) was trained on a narrow theme set: it confuses queens and kings on chess.com themes and cannot read book diagrams. Commercial tools do it well, but closed, with accounts, on their servers.

fenshot's classifier was trained from scratch on a synthetic corpus, known positions rendered across ~72 piece sets, ~55 board themes, procedural flat boards, and book-diagram hatch styles, with real-world screenshot degradations baked in. On the real-screenshot eval set the legacy model misread up to 34 tiles per board; fenshot ships at zero. The full story is in the [package README](packages/fenshot/README.md#how-it-works-and-why-it-reads-book-diagrams).

## Repo layout

- `packages/fenshot` — the npm package: board detection, tile classification, FEN composition, golden regression tests.
- `apps/web` — the demo site (Vite + React), deployed to GitHub Pages.

## Development

```bash
npm install
npm test          # golden regression suite
npm run build     # build the package
npm run dev       # run the demo app
```

## Credits

Board detection is a TypeScript port of chessboard_finder.py from [Elucidation/tensorflow_chessbot](https://github.com/Elucidation/tensorflow_chessbot) (MIT). Built and maintained by [coachess.app](https://coachess.app).

MIT licensed.
