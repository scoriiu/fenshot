# Store assets, 0.5.0

Upload in this order (Chrome Web Store dashboard, top to bottom). All
24-bit PNG (no alpha) except the icon. Delete the old July screenshots
and tiles in the dashboard first.

| # | File | Dashboard slot |
|---|---|---|
| 1 | `1-store-icon-128x128.png` | Store icon (96x96 artwork, 16px transparent padding) |
| 2 | `2-screenshot-1-hero-1280x800.png` | Screenshot 1: the popup reading a board (Wikipedia, Opera Game) |
| 3 | `3-screenshot-2-chesscom-1280x800.png` | Screenshot 2: the Analyze button on chess.com |
| 4 | `4-screenshot-3-lichess-1280x800.png` | Screenshot 3: the Analyze button on Lichess |
| 5 | `5-screenshot-4-result-1280x800.png` | Screenshot 4: the game on kibitzo.com |
| 6 | `6-small-promo-tile-440x280.png` | Small promo tile |
| 7 | `7-marquee-promo-tile-1400x560.png` | Marquee promo tile |

The promo video stays as it is.

Regenerate (from the repo root, after `npm run build -w extension`):

    node store-assets/0.5.0/make-hero.mjs      # real popup reading the Wikipedia diagram
    node store-assets/0.5.0/make-result.mjs    # kibitzo.com analysis board
    python3 store-assets/0.5.0/make-icon.py
    node store-assets/0.5.0/make-tiles.mjs
    python3 store-assets/0.5.0/compose.py      # caption bars, highlights, final sizes

`raw/` (gitignored) holds the captures, including the chess.com page capture
and the founder's logged-in Lichess screenshot.
