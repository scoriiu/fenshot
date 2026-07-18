/**
 * cburnett piece set (Colin M.L. Burnett, GPL/BSD multi-license, via
 * lichess-org/lila), inlined as raw SVG markup so the board preview
 * paints synchronously with the rest of the popup. <img> tags load
 * async even from disk and caused a visible piece pop-in.
 */

import wK from "./pieces-svg/wK.svg?raw";
import wQ from "./pieces-svg/wQ.svg?raw";
import wR from "./pieces-svg/wR.svg?raw";
import wB from "./pieces-svg/wB.svg?raw";
import wN from "./pieces-svg/wN.svg?raw";
import wP from "./pieces-svg/wP.svg?raw";
import bK from "./pieces-svg/bK.svg?raw";
import bQ from "./pieces-svg/bQ.svg?raw";
import bR from "./pieces-svg/bR.svg?raw";
import bB from "./pieces-svg/bB.svg?raw";
import bN from "./pieces-svg/bN.svg?raw";
import bP from "./pieces-svg/bP.svg?raw";

const BY_NAME: Record<string, string> = {
  wK, wQ, wR, wB, wN, wP, bK, bQ, bR, bB, bN, bP,
};

/** FEN piece char ("K", "p", …) → inline SVG markup. */
export function pieceSvg(piece: string): string {
  const color = piece === piece.toUpperCase() ? "w" : "b";
  return BY_NAME[`${color}${piece.toUpperCase()}`] ?? "";
}
