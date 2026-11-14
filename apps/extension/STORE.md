# Store listing copy

One source of truth for every store (Chrome Web Store, Edge Add-ons, Firefox AMO).
Update here first, then paste into the store dashboards.

## Name

fenshot: chess board to FEN, one click

## Short description (132 chars max for CWS)

<!-- 2026-09-28: leads with "chess screenshot to FEN", the phrase people
     search (Search Console on fenshot.com). Paste into all three stores. -->

Chess screenshot to FEN in one click: reads the board on any page, and whole games from move lists. Runs entirely on your device.

## Detailed description

New: an Analyze in Kibitzo button on chess.com and Lichess. Turn it on
once, and every finished game gets a button under Game Review (chess.com)
or in the game panel (Lichess) that opens it on a free analysis board.
Optional, off until you switch it on.

Whole games: on chessgames.com, Lichess, a chess.com article or a blog,
one click reads the full game and opens it for review.

Turn any chessboard you see into a position you can analyze. One click, on any page.

Watching a YouTube video, reading a book PDF, scrolling a blog or a chess.com article? Click the fenshot icon. It reads the board on your screen and gives you the position.

WHAT YOU GET
• Analyze on Kibitzo: the position opens with a coach that explains it in plain words
• Open on Lichess: straight into the analysis board
• Copy FEN: paste it anywhere

WHOLE GAMES, NOT JUST POSITIONS
When a page shows a game as a move list (chessgames.com, Lichess, chess.com articles, blogs), fenshot finds it, checks that every move is legal, and lets you step through it on a small board. One click opens the full game on Kibitzo or Lichess, or copies the PGN. Several games on one page? Page through them.

PRIVATE BY DESIGN
• Reads the page only when you click the icon, and only that tab
• The optional Analyze button runs only on chess.com and Lichess, only after you turn it on, and only adds a link: it never reads your moves during a game
• The neural network runs 100% on your device. Nothing is uploaded
• No account, no analytics, no tracking
• Open source (MIT): github.com/scoriiu/fenshot

HONEST WHEN IT IS UNSURE
Works with Lichess and chess.com themes, book diagrams and most piece sets. When a board is hard to read, fenshot tells you instead of guessing, and opens an editor so you can fix the squares.

Made by the team behind Kibitzo (kibitzo.com), from the same engine that imports positions there.

## Category

- CWS: Tools (or "Fun" secondary)
- AMO: Games & Entertainment / Tools
- Edge: Productivity or Entertainment

## Privacy policy URL

https://fenshot.com/extension-privacy.html

## Permission justification (CWS review form)

activeTab: the extension's single function is reading the chess content
visible on the current tab. activeTab grants one-time access to that
tab, only when the user clicks the toolbar icon. No host permissions
by default.

optional_host_permissions (https://www.chess.com/*, https://lichess.org/*):
requested only when the user clicks "+ Analyze button" in the popup,
never at install. Once granted, one small content script
(site-button.js) runs on those two sites and adds an "Analyze in
Kibitzo" link next to a FINISHED game's own review controls (chess.com's
Game Review button, Lichess's post-game panel). It reads only the game
id, the player names shown and the board orientation, to build that
link; it never reads or changes anything during a game in progress, and
sends nothing anywhere itself. Turning the switch off removes the access
and the button. Source: apps/extension/src/site-button.ts,
site-access.ts.

background (service worker): three listeners (permissions.onAdded,
permissions.onRemoved, runtime.onInstalled) that register or unregister
the content script above so it always matches the access the user has
granted. No network, no storage, no timers. Source:
apps/extension/src/background.ts.

scripting: used together with activeTab, and only on the click, to run
one small function in the current tab that returns the page's visible
text (document.body.innerText, textarea values, <pre> blocks). The
extension scans that text for a chess game written as a move list. The
function is self-contained, injects nothing persistent, modifies
nothing on the page, and the text is processed locally and discarded
when the popup closes. Source: apps/extension/src/pgn.ts
(collectPageText).

Since 0.6.2 the same click runs one more small function in the tab. It
looks for a chess board the page draws itself (Lichess's chessground
wrapper, chess.com's board element) and returns only where that board is
on the screen and which side is at the bottom, taken from a class name.
It reads no moves, no text and nothing about the user, changes nothing on
the page, and its answer is used once, to show the position the right way
round. Source: apps/extension/src/board-side.ts (collectBoardSides).

## Single purpose statement (CWS review form)

Reads the chess position, and any chess game, from the visible tab and
opens it for analysis.

## Data disclosure (CWS "data usage" form)

Collects no data of any kind. All processing is local. Check "does not
collect or use data".

The optional Analyze button is a plain link the user clicks; the
extension transmits nothing. The link carries the game's public id and
the two usernames shown on that public game page, so kibitzo.com can
open that game.

Note for reviewers who read link URLs: the "Kibitzo" buttons open
kibitzo.com with utm_source=fenshot&utm_medium=extension in the URL.
That is a static tag identifying the extension as the referrer, added
only to links the user clicks; it carries no identifier and no data
about the user or the page.

## Firefox (AMO) notes

Build steps for the reviewer (verified 2026-11-08: a clean build from the
source zip is byte-identical to the Firefox zip, `diff -rq`), Node 24 / npm 11:

    npm ci                               # from the unzipped source root
    npm run build -w @scoriiu/fenshot    # the recognizer package the extension imports
    npm run build -w extension           # -> apps/extension/dist == the Firefox zip

- Source code is required because the build step bundles the ONNX
  runtime. Upload the `fenshot-source-<version>.zip` produced by
  `git archive` (see "Packaging" below); the README covers the build.
- data_collection_permissions in the manifest stays `required: ["none"]`.

## Translations

Romanian (ro) and Hebrew (he) ship with 0.6.2 (0.6.1 was never sent to
the stores): public/_locales/{ro,he}, and store-listing/{ro,he}.md to
paste into the two new per-language listings.

The extension follows the browser's language: es, de, ru, fr, pt_BR, it,
zh_CN, tr, nl, pl, vi, fa, ar, ro, he, and English otherwise (public/_locales,
checked by `node scripts/i18n-check.mjs`). Store listings per language
(name, short description, detailed description) are in store-listing/,
to paste into each store's per-language listing fields. The reviewer
forms below stay English.

## Release notes (0.6.2, covers 0.6.1)

Fewer wrong reads, and a board that shows which way it faces.

- On chess.com and Lichess, fenshot now takes the board's direction from
  the page itself. Endgames seen from Black's side sometimes came out
  upside down.
- A new button says which side is at the bottom. Press it when a
  screenshot from another site is read the wrong way round.
- The board in the popup has coordinates and new pieces, the same ones
  as on Kibitzo.
- Fixed: in Persian and Arabic the board was drawn mirrored.
- New languages: Romanian and Hebrew.

Notes to reviewer (AMO): no new permission. One new source file,
src/board-side.ts: `collectBoardSides` is injected with
scripting.executeScript on the user's click (activeTab), the same pattern
as `collectPageText` in src/pgn.ts. It reads only the class names and the
bounding boxes of board elements (`.cg-wrap.orientation-*`,
`wc-chess-board`, `chess-board`) and returns where each board is and
which side is at the bottom; nothing is stored or sent. The popup's board
gets coordinates and `direction: ltr` (src/popup.ts, src/popup.css). The
twelve piece pictures in src/pieces-svg are replaced by our own set
(CC BY 4.0, src/pieces-svg/NOTICE.md; written by
scripts/update-pieces.mjs, which is not part of the build). Two
new locale folders: public/_locales/ro and public/_locales/he. Build
steps unchanged (see Firefox (AMO) notes).

## Release notes (0.6.1, not sent to the stores)

Now also in Romanian and Hebrew (right to left). No other changes.

Notes to reviewer (AMO): translations only: two new folders,
public/_locales/ro and public/_locales/he. No code, permission or
behaviour change. Build steps unchanged (see Firefox (AMO) notes).

## Release notes (0.6.0)

fenshot now speaks your language: the popup, the toolbar tooltip and the
Analyze in Kibitzo button follow your browser's language, in Spanish,
German, Russian, French, Portuguese, Italian, Chinese, Turkish, Dutch,
Polish, Vietnamese, Persian and Arabic (right to left), and English
otherwise.

Notes to reviewer (AMO): no new permissions and no behaviour change. New
files: public/_locales/*/messages.json (Chrome i18n format; manifest name,
description and action title are __MSG_ references, default_locale en)
and src/i18n.ts (chrome.i18n.getMessage with a bundled English fallback).
Build steps unchanged: npm run build.

## Release notes (0.5.0)

New, optional: an "Analyze in Kibitzo" button on finished chess.com and
Lichess games. Click "+ Analyze button" in the popup to turn it on; the
browser asks once for access to those two sites. Each finished game then
gets one button that opens it on a free analysis board. Turn it off from
the same place and it disappears at once. Never shown during a game.
The popup also shows its version now.

Notes to reviewer (AMO): new optional_host_permissions for
https://www.chess.com/* and https://lichess.org/*, requested at runtime
from the popup only (never at install), plus a background script that
keeps the registered content script in step with the granted access.
New files: src/site-button.ts (content script, built standalone by
vite.scripts.config.ts), src/site-access.ts, src/background.ts. No data
collection: the button is a link; data_collection_permissions stays
"none". Build steps: npm run build (now three vite builds, see
package.json); see the README in the source zip.

## Release notes (0.4.6, covers 0.4.5)

Chess.com games now import when your move list shows piece icons
(figurine notation). Before, the extension found no game on those pages.
A move time such as "1.5s" no longer cuts a game in two.
"Analyze on Coachess" is now "Analyze on Kibitzo" (the site's new name).
No new permissions. Nothing leaves your device until you choose to
analyze a game.

Notes to reviewer (AMO): no permission or data-handling changes since
0.4.4. Changes: src/pgn.ts (move-list reading: figurine icons on
chess.com, decimal clock values) and the link and label for the renamed
analysis site (kibitzo.com). Build steps are unchanged; see the README
in the source zip.

## Release notes (0.4.4)

A quiet, one-time ask for a store rating after your 5th successful read.
Nothing else changes: no new permissions, no data leaves your device
(the counter lives in the popup's own local storage).

## Packaging

    cd apps/extension
    npm run package                      # -> two zips from one build:
    #   fenshot-extension-<version>-chromium.zip   Chrome Web Store + Edge (background.service_worker only;
    #                                              Edge rejects background.scripts in MV3)
    #   fenshot-extension-<version>-firefox.zip    AMO (background.scripts, which Firefox needs)
    git archive -o apps/extension/fenshot-source-<version>.zip HEAD   # from repo root, for AMO

Both zips are gitignored. Bump `version` in package.json and
public/manifest.json together.

## Assets

- Icon 128x128: dist/icons/icon-128.png
- Screenshots 1280x800: generated by the harness (.tmp/store-shots.mjs),
  regenerate after any popup visual change

## Edge listing extras (every language asks again)

- YouTube video URL: https://www.youtube.com/watch?v=IuXVrPKHzkY
- Search terms (max 7 terms, 30 characters each, 21 words total; no
  competitor trademarks): image to fen · chess screenshot to fen ·
  chess board scanner · fen from image · chess position recognition ·
  lichess analysis · pdf chess diagram
- Logo 300x300: store-assets/logo-300.png
