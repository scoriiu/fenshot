# Store assets, 0.5.0

Chrome Web Store / Edge / AMO listing images. All 24-bit PNG (no alpha) except the icon.

| File | Store slot |
|---|---|
| `fenshot-store-icon-128.png` | Store icon (96x96 artwork, 16px transparent padding) |
| `fenshot-0.5.0-1-hero-1280x800.png` | Screenshot 1: the popup reading a board (Wikipedia, Opera Game) |
| `fenshot-0.5.0-2-chesscom-1280x800.png` | Screenshot 2: the Analyze button on chess.com |
| `fenshot-0.5.0-3-lichess-1280x800.png` | Screenshot 3: the Analyze button on Lichess |
| `fenshot-0.5.0-4-result-1280x800.png` | Screenshot 4: the game on kibitzo.com |
| `fenshot-0.5.0-tile-small-440x280.png` | Small promo tile |
| `fenshot-0.5.0-tile-marquee-1400x560.png` | Marquee promo tile |

Regenerate (from the repo root, after `npm run build -w extension`):

    node store-assets/0.5.0/make-hero.mjs      # real popup reading the Wikipedia diagram
    node store-assets/0.5.0/make-result.mjs    # kibitzo.com analysis board
    python3 store-assets/0.5.0/make-icon.py
    node store-assets/0.5.0/make-tiles.mjs
    python3 store-assets/0.5.0/compose.py      # caption bars, highlights, 1280x800

`raw/` (gitignored) holds the captures, including the chess.com page capture
and the founder's logged-in Lichess screenshot.
