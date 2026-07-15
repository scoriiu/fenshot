/**
 * FEN composition helpers for scan results. A recognizer returns a
 * bare placement; these build a full analyzable FEN from it without
 * pulling in a chess library.
 */

function expandRank(rank: string): string {
  return rank.replace(/\d/g, (d) => ".".repeat(Number(d)));
}

/** Derive castling rights from piece placement (screenshots carry no
 *  history). King + rook on their home squares keep the right;
 *  anything else drops it. */
export function inferCastling(placement: string): string {
  const rows = placement.split("/");
  if (rows.length !== 8) return "-";
  const white = expandRank(rows[7]);
  const black = expandRank(rows[0]);
  let rights = "";
  if (white[4] === "K") {
    if (white[7] === "R") rights += "K";
    if (white[0] === "R") rights += "Q";
  }
  if (black[4] === "k") {
    if (black[7] === "r") rights += "k";
    if (black[0] === "r") rights += "q";
  }
  return rights || "-";
}

/** Build a full FEN from a placement and side to move. Castling is
 *  inferred from home squares; en passant, halfmove and fullmove get
 *  neutral defaults (unknowable from a screenshot). */
export function placementToFen(placement: string, turn: "w" | "b"): string {
  return `${placement} ${turn} ${inferCastling(placement)} - 0 1`;
}
