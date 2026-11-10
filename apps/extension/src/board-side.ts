/**
 * Which side is at the bottom of a board, read from the page instead of
 * guessed from the pieces.
 *
 * The recognizer reads squares, not direction: it decides the side from
 * where the pawns stand, and that fails in endgames (measured: 4 to 7% of
 * endgame positions, the cause of every silent misread on site-drawn
 * boards in the benchmark). chess.com and every chessground site (Lichess)
 * say the side in the page itself, so on those pages the popup asks.
 *
 * Two halves, like pgn.ts: `collectBoardSides` runs inside the tab and
 * must be self-contained; `sideOfBoard` runs in the popup.
 */

export type Side = "white" | "black";

export interface PageBoard {
  /** Where the board is, as fractions of the viewport (0..1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  side: Side;
}

/** Injected into the page. Self-contained on purpose; see file header. */
export function collectBoardSides(): PageBoard[] {
  const out: PageBoard[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!vw || !vh) return out;
  const add = (el: Element, side: Side) => {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    out.push({ x0: r.left / vw, y0: r.top / vh, x1: r.right / vw, y1: r.bottom / vh, side });
  };
  // chessground (Lichess and the sites built on it) marks the wrapper.
  for (const el of document.querySelectorAll(".cg-wrap.orientation-white")) add(el, "white");
  for (const el of document.querySelectorAll(".cg-wrap.orientation-black")) add(el, "black");
  // chess.com: the board element carries "flipped" when Black is at the bottom.
  for (const el of document.querySelectorAll("wc-chess-board, chess-board")) {
    add(el, el.classList.contains("flipped") ? "black" : "white");
  }
  return out;
}

/** A page board counts as the one that was read when the two boxes share
 *  at least this much of their combined area. */
const MIN_OVERLAP = 0.6;

/**
 * The side of the page board that the recognizer's box sits on, or null
 * when no page board matches (the popup then keeps the pawn rule). `box`
 * and the boards are in the same fractions of the captured viewport.
 */
export function sideOfBoard(box: { x0: number; y0: number; x1: number; y1: number }, boards: PageBoard[]): Side | null {
  let best: Side | null = null;
  let bestOverlap = MIN_OVERLAP;
  for (const b of boards) {
    const w = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0);
    const h = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
    if (w <= 0 || h <= 0) continue;
    const union = (box.x1 - box.x0) * (box.y1 - box.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - w * h;
    const overlap = (w * h) / union;
    if (overlap >= bestOverlap) {
      bestOverlap = overlap;
      best = b.side;
    }
  }
  return best;
}
