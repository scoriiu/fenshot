/**
 * Model output to FEN piece placement. The classifier emits 13-class
 * probabilities per tile in A1..H8 rank order; class labels are
 * '1KQRBNPkqrbnp' (index 0 = empty square).
 */

const LABELS = "1KQRBNPkqrbnp";

export interface RecognitionResult {
  /** FEN piece-placement field (ranks 8..1), run-length compressed. */
  placement: string;
  /** Per-tile argmax confidence, A1..H8 rank order. */
  confidences: number[];
  /** The weakest tile confidence. Below ~0.7 treat as unreliable. */
  minConfidence: number;
  /** Average tile confidence; used to arbitrate between candidate
   *  board alignments (recognize.ts). */
  meanConfidence: number;
}

export function probsToPlacement(probs: Float32Array): RecognitionResult {
  const names: string[] = [];
  const confidences: number[] = [];
  for (let i = 0; i < 64; i++) {
    let best = -1;
    let bestIdx = 0;
    for (let c = 0; c < 13; c++) {
      const p = probs[i * 13 + c];
      if (p > best) {
        best = p;
        bestIdx = c;
      }
    }
    names.push(LABELS[bestIdx]);
    confidences.push(best);
  }
  const ranks: string[] = [];
  for (let r = 7; r >= 0; r--) {
    ranks.push(names.slice(r * 8, r * 8 + 8).join(""));
  }
  const placement = ranks
    .join("/")
    .replace(/1{2,}/g, (m) => String(m.length));
  return {
    placement,
    confidences,
    minConfidence: Math.min(...confidences),
    meanConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
  };
}

/** Mirror a placement for a board photographed with Black at the
 *  bottom (rotate 180 degrees: reverse ranks and files). */
export function flipPlacement(placement: string): string {
  return placement
    .split("/")
    .reverse()
    .map((rank) => rank.split("").reverse().join(""))
    .join("/");
}

/** Mean rank of each color's pawns, reading `placement` as a
 *  white-at-bottom board (rank 8 = first row, rank 1 = last row).
 *  Returns null for a color with no pawns. */
function meanPawnRanks(placement: string): { white: number | null; black: number | null } {
  const ranks = placement.split("/");
  const white: number[] = [];
  const black: number[] = [];
  ranks.forEach((row, i) => {
    const rank = 8 - i;
    for (const ch of row) {
      if (ch === "P") white.push(rank);
      else if (ch === "p") black.push(rank);
    }
  });
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return { white: mean(white), black: mean(black) };
}

/** Decide board orientation from pawn-advance direction, the one
 *  orientation-fixed fact in chess: white pawns march up the ranks
 *  (home 2, promote 8), black pawns march down (home 7, promote 1).
 *  In any natural position white pawns sit, on average, on LOWER
 *  ranks than black pawns. The recognizer always reads tiles as if
 *  white were at the bottom, so a screenshot taken from Black's side
 *  comes back with that relationship inverted (white pawns appear
 *  high, black low). We compare the read against its 180-rotation and
 *  keep whichever has white pawns lower than black. When there are no
 *  pawns of one color, or the signal ties, orientation is genuinely
 *  undecidable from pixels, so we keep the white-at-bottom read and
 *  leave the call to the user's flip toggle. */
export function resolveOrientation(placement: string): {
  placement: string;
  orientation: "white" | "black";
} {
  const naturalness = (p: string): number | null => {
    const { white, black } = meanPawnRanks(p);
    if (white == null || black == null) return null;
    return black - white;
  };
  const asRead = naturalness(placement);
  const rotated = flipPlacement(placement);
  const asRotated = naturalness(rotated);
  if (asRead != null && asRotated != null && asRotated > asRead) {
    return { placement: rotated, orientation: "black" };
  }
  return { placement, orientation: "white" };
}
