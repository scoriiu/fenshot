# fenshot: notes for agents and contributors

This repo holds the open-source fenshot projects (MIT):

| Path | What |
|------|------|
| `packages/fenshot` | The recognizer: chess screenshot in, FEN out (npm `@scoriiu/fenshot`) |
| `apps/web` | fenshot.com, in 16 languages |
| `apps/extension` | The browser extension (Chrome, Firefox, Edge) |
| `tools/benchmark` | The public accuracy benchmark behind fenshot.com/accuracy/ |

## Hard rules

- **Recognizer changes go through the benchmark** (`tools/benchmark/README.md`):
  score before and after on the same images; nothing that was right may
  become wrong; publish the new numbers with `node tools/benchmark/publish.mjs`.
  Never train on benchmark images.
- **The website's English pages are the source** (`apps/web/index.html`,
  `apps/web/public/*/index.html`); translations live in `apps/web/i18n/`.
  After an English edit: `node scripts/i18n-extract.mjs`, translate the new
  segments, `node scripts/i18n-check.mjs` must pass. `npm run smoke -w web`
  checks the result screen on language pages.
- **No em dashes, en dashes or double hyphens in user-facing copy.** No
  false claims about competitors or about features fenshot does not have.
- **A push to `main` deploys fenshot.com** (GitHub Pages). Work locally until
  the change is meant to go live.
- **The chessboard is not in this repo.** Lightsquare, our own board, lives at
  `github.com/kibitzo/lightsquare` (local clone `~/git/lightsquare`). Never
  copy it in here: one home per project.
