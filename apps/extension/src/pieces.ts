/**
 * cburnett piece set (Colin M.L. Burnett, GPL/BSD multi-license, via
 * lichess-org/lila), bundled as raw SVG markup and parsed once into
 * template elements. Pieces are cloned per square so the board builds
 * with DOM APIs only, no innerHTML anywhere in the popup.
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

const templates = new Map<string, SVGSVGElement>();

/** FEN piece char ("K", "p", …) → a fresh SVG element, or null. */
export function pieceElement(piece: string): SVGSVGElement | null {
  const name = (piece === piece.toUpperCase() ? "w" : "b") + piece.toUpperCase();
  let template = templates.get(name);
  if (!template) {
    const raw = BY_NAME[name];
    if (!raw) return null;
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
    const root = doc.documentElement;
    if (!(root instanceof SVGSVGElement)) return null;
    template = root;
    templates.set(name, template);
  }
  return template.cloneNode(true) as SVGSVGElement;
}
