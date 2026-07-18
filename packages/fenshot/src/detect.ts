/**
 * Chessboard detection in a screenshot. Pure TypeScript port of
 * chessboard_finder.py from Elucidation/tensorflow_chessbot (MIT).
 *
 * Input: grayscale image as Float32Array (0-255 values, row-major).
 * Output: board bounding box in image coordinates, or null when no
 * board-like gradient structure is found.
 *
 * Algorithm: image gradients split into +/- components, summed into
 * 1D "hough" responses per row and per column. Board edges produce
 * strong evenly spaced peaks; we find length-7+ arithmetic sequences
 * of peaks (the 7 inner lines of an 8x8 board), then pick the 7x7
 * sub-grid whose crop correlates best with an ideal checkerboard
 * kernel. Faithful to the python reference, validated against its
 * outputs in tests/unit/board-scan.test.ts.
 *
 * Deliberate deviation from the reference: its noise pre-gate
 * (std(hough)/length >= 8000 on both axes) is removed. The metric is
 * scale-dependent, so a page screenshot whose board spans only part
 * of a wide frame fails the gate even when the board peaks are
 * pristine (reddit-page-board.png in the test set). Measured against
 * the fixture corpus the gate rejected nothing the arithmetic
 * sequence search did not already reject.
 */

export interface BoardCorners {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

const PEAK_KEEP_RATIO = 0.2;
const MIN_SEQ_LEN = 7;
const ERR_PX = 5;

function max(arr: ArrayLike<number>, from: number, to: number): number {
  let m = -Infinity;
  for (let i = from; i < to; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/** np.gradient semantics: central differences, one-sided at edges. */
function gradientRows(img: GrayImage): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    out[x] = data[width + x] - data[x];
    const last = (height - 1) * width;
    out[last + x] = data[last + x] - data[last - width + x];
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = (data[(y + 1) * width + x] - data[(y - 1) * width + x]) / 2;
    }
  }
  return out;
}

function gradientCols(img: GrayImage): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    out[row] = data[row + 1] - data[row];
    out[row + width - 1] = data[row + width - 1] - data[row + width - 2];
    for (let x = 1; x < width - 1; x++) {
      out[row + x] = (data[row + x + 1] - data[row + x - 1]) / 2;
    }
  }
  return out;
}

/** hough[i] = sum(positive part along axis) * sum(negative part along axis). */
function houghResponse(grad: Float32Array, width: number, height: number, axis: "rows" | "cols"): Float64Array {
  const n = axis === "rows" ? height : width;
  const pos = new Float64Array(n);
  const neg = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = grad[y * width + x];
      const i = axis === "rows" ? y : x;
      if (g > 0) pos[i] += g;
      else neg[i] -= g;
    }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = pos[i] * neg[i];
  return out;
}

/** Faithful port of nonmax_suppress_1d (including its edge quirks:
 *  strict < against the left window, <= against the right window). */
function nonmaxSuppress(arr: Float64Array, winsize = 5): Float64Array {
  const out = Float64Array.from(arr);
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const left = i === 0 ? 0 : max(arr, Math.max(0, i - winsize), i);
    const right = i >= n - 2 ? 0 : max(arr, i + 1, Math.min(n - 1, i + winsize));
    if (arr[i] < left || arr[i] <= right) out[i] = 0;
  }
  return out;
}

/** All arithmetic sequences (within ERR_PX) of length >= MIN_SEQ_LEN. */
function getAllSequences(seq: number[]): number[][] {
  if (seq.length < MIN_SEQ_LEN) return [];
  const seqs: number[][] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      let duplicate = false;
      for (const prev of seqs) {
        for (let k = 0; k < prev.length - 1; k++) {
          if (seq[i] === prev[k] && seq[j] === prev[k + 1]) duplicate = true;
        }
      }
      if (duplicate) continue;
      const d = seq[j] - seq[i];
      if (d < ERR_PX) continue;
      const s = [seq[i], seq[j]];
      let n = s[s.length - 1] + d;
      for (;;) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let k = 0; k < seq.length; k++) {
          const dist = Math.abs(seq[k] - n);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = k;
          }
        }
        if (bestDist >= ERR_PX) break;
        n = seq[bestIdx];
        s.push(n);
        n = s[s.length - 1] + d;
      }
      if (s.length >= MIN_SEQ_LEN) seqs.push(s);
    }
  }
  return seqs;
}

/** Strip weakest edges until sequence is at most 9 long. */
function trimSequence(seq: number[], vals: number[]): { seq: number[]; vals: number[] } {
  let s = seq.slice();
  let v = vals.slice();
  if (s.length > 9) {
    while (s.length > 7) {
      if (v[0] > v[v.length - 1]) {
        s = s.slice(0, -1);
        v = v.slice(0, -1);
      } else {
        s = s.slice(1);
        v = v.slice(1);
      }
    }
  }
  return { seq: s, vals: v };
}

function median(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Crop (zero-padded out of bounds) + nearest resize to 64x64,
 *  correlate against ideal checkerboard kernel.
 *
 *  SIGNED, deliberately: the kernel's +1 cells are the crop's corner
 *  parity, and a chessboard's corner squares (a8/h1 side) are the
 *  LIGHT squares in either orientation, so a correctly aligned crop
 *  correlates positive. A crop misaligned by an odd number of tiles
 *  inverts the parity and goes negative, which is what lets the
 *  arbitration reject one-tile-shifted boxes that abs() used to score
 *  as high as the truth (found via the marble-theme web-eval case:
 *  sparse position, confident read, every piece one file off). */
function checkerboardScore(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  let score = 0;
  for (let ty = 0; ty < 64; ty++) {
    const sy = y0 + Math.floor((ty * h) / 64);
    for (let tx = 0; tx < 64; tx++) {
      const sx = x0 + Math.floor((tx * w) / 64);
      let px = 0;
      if (sx >= 0 && sx < img.width && sy >= 0 && sy < img.height) {
        px = img.data[sy * img.width + sx];
      }
      // kernel: +1 on (tile parity even), -1 odd, tiles are 8x8 px;
      // normalized by sqrt(64*64) = 64 like np.linalg.norm of +/-1 grid.
      const parity = (Math.floor(tx / 8) + Math.floor(ty / 8)) % 2 === 0 ? 1 : -1;
      score += (parity * px) / 64;
    }
  }
  return score;
}

/** How many candidate line sequences the one-axis reconstruction
 *  arbitrates between. Piece edges and adjacent UI lines can form a
 *  shifted arithmetic sequence whose peak values narrowly beat the true
 *  grid's; checkerboard correlation separates them reliably, so several
 *  candidates are kept instead of trusting peak strength alone. */
const MAX_CANDIDATE_SEQS = 5;

interface CandidateSequence {
  /** Trimmed to 7-9 lines by weakest-end peak value: what the two-axis
   *  sub-grid path consumes (faithful to the python reference). */
  trimmed: number[];
  /** The full arithmetic sequence before trimming. The trim ranks by
   *  peak VALUE, and phantom lines (board edge, adjacent UI) can carry
   *  stronger peaks than true grid lines, so the one-axis
   *  reconstruction enumerates sub-grids of the full sequence instead
   *  and lets checkerboard correlation arbitrate. */
  full: number[];
}

function rankedPeakSequences(hough: Float64Array): CandidateSequence[] {
  const suppressed = nonmaxSuppress(hough);
  const peak = max(suppressed, 0, suppressed.length);
  if (peak <= 0) return [];
  const positions: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < suppressed.length; i++) {
    const v = suppressed[i] / peak;
    if (v >= PEAK_KEEP_RATIO) {
      positions.push(i);
      values.push(v);
    }
  }
  const seqs = getAllSequences(positions);
  if (seqs.length === 0) return [];
  const valueAt = new Map(positions.map((p, i) => [p, values[i]]));
  const scored = seqs.map((seq) => {
    const vals = seq.map((p) => valueAt.get(p) ?? 0);
    const trimmed = trimSequence(seq, vals);
    return {
      candidate: { trimmed: trimmed.seq, full: seq },
      score: trimmed.vals.reduce((a, b) => a + b, 0) / trimmed.vals.length,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const unique: CandidateSequence[] = [];
  for (const { candidate } of scored) {
    if (
      !unique.some(
        (u) => u.full.length === candidate.full.length && u.full.every((v, i) => v === candidate.full[i]),
      )
    ) {
      unique.push(candidate);
    }
    if (unique.length >= MAX_CANDIDATE_SEQS) break;
  }
  return unique;
}

/**
 * Grid-snap refinement candidate: the peak-sequence search can lock
 * onto an offset grid when the board texture itself is edge-rich
 * (hatched book diagrams put more gradient energy inside squares
 * than on the grid lines). Checkerboard correlation peaks at true
 * alignment on such boards, but is too crude to be trusted blindly
 * on photo-textured boards, so callers treat the snapped box as a
 * CANDIDATE alongside the raw one and let the tile classifier pick
 * the alignment with higher mean confidence (recognize.ts).
 */
export function snapCorners(img: GrayImage, box: BoardCorners): BoardCorners {
  const tile = (box.x1 - box.x0) / 8;
  const radius = Math.max(2, Math.round(tile / 3));
  let bestDx = 0;
  let bestDy = 0;
  let bestScore = -Infinity;
  const evalAt = (dx: number, dy: number) => {
    const score = checkerboardScore(img, box.x0 + dx, box.y0 + dy, box.x1 + dx, box.y1 + dy);
    if (score > bestScore) {
      bestScore = score;
      bestDx = dx;
      bestDy = dy;
    }
  };
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      evalAt(dx, dy);
    }
  }
  const cx = bestDx;
  const cy = bestDy;
  for (let dy = cy - 2; dy <= cy + 2; dy++) {
    for (let dx = cx - 2; dx <= cx + 2; dx++) {
      evalAt(dx, dy);
    }
  }
  return { x0: box.x0 + bestDx, y0: box.y0 + bestDy, x1: box.x1 + bestDx, y1: box.y1 + bestDy };
}

/**
 * One-axis fallback: when the grid lines are clean on one axis but the
 * other axis's internal lines are drowned out (low square-contrast
 * boards where black pieces dump more gradient energy than the faint
 * grid, e.g. white/pale-blue themes), reconstruct the missing axis from
 * the good one. A chessboard is square, so the board's extent on the
 * weak axis equals 8 tiles of the good axis's spacing; slide that square
 * window along the weak axis and keep the position whose checkerboard
 * correlation is strongest. Returns null if nothing scores well, so this
 * cannot manufacture a board out of noise — checkerboardScore arbitrates.
 */
function reconstructSquareBoard(
  img: GrayImage,
  good: number[],
  axis: "x" | "y",
): { box: BoardCorners; score: number } | null {
  const tile = median(good.slice(1).map((v, i) => v - good[i]));
  if (!(tile > 0)) return null;
  // The good-axis sequence is ambiguous: its lines can be the 7 INNER
  // grid lines (extent = one tile beyond each end), can include one or
  // both OUTER edges, or can include phantom lines from adjacent UI.
  // Enumerate the same candidates the two-axis path considers: every
  // 7-line sub-grid padded by one tile, plus the whole span read as
  // outer-edge-to-outer-edge. Checkerboard correlation arbitrates.
  const gA = Math.round(good[0]);
  const gB = Math.round(good[good.length - 1]);
  if (gB - gA <= 0) return null;
  const pad = Math.round(tile);
  const extents: Array<[number, number]> = [[gA, gB]];
  for (let k = 0; k + 7 <= good.length; k++) {
    const e: [number, number] = [Math.round(good[k]) - pad, Math.round(good[k + 6]) + pad];
    if (!extents.some(([a, b]) => Math.abs(a - e[0]) <= 2 && Math.abs(b - e[1]) <= 2)) {
      extents.push(e);
    }
  }
  const limit = axis === "x" ? img.height : img.width;

  let best: BoardCorners | null = null;
  let bestScore = -Infinity;
  for (const [eA, eB] of extents) {
    const span = eB - eA;
    const step = Math.max(2, Math.round(tile / 8));
    for (let start = -span; start <= limit; start += step) {
      const wA = start;
      const wB = start + span;
      const box: BoardCorners =
        axis === "x"
          ? { x0: eA, y0: wA, x1: eB, y1: wB }
          : { x0: wA, y0: eA, x1: wB, y1: eB };
      const score = checkerboardScore(img, box.x0, box.y0, box.x1, box.y1);
      if (score > bestScore) {
        bestScore = score;
        best = box;
      }
    }
  }
  return best ? { box: best, score: bestScore } : null;
}

/** One-axis fallback across ALL candidate line sequences of the good
 *  axis: a shifted sequence can out-score the true grid on raw peak
 *  strength, so every candidate is reconstructed (from its FULL
 *  untrimmed line list) and the checkerboard correlation picks the
 *  winner. */
function reconstructFromCandidates(
  img: GrayImage,
  candidates: CandidateSequence[],
  axis: "x" | "y",
): BoardCorners | null {
  let best: BoardCorners | null = null;
  let bestScore = -Infinity;
  for (const { full } of candidates) {
    const r = reconstructSquareBoard(img, full, axis);
    if (r && r.score > bestScore) {
      bestScore = r.score;
      best = r.box;
    }
  }
  return best;
}

/** A negative checkerboard correlation on the chosen box means its
 *  parity is inverted: the grid was found but placed an odd number of
 *  tiles off (an outer edge displacing an inner line in the peak
 *  sequence shifts the whole box by one tile). The true box is then
 *  one tile away in one direction; try all four and keep the best
 *  positive. Found via the marble-theme web-eval case: sparse
 *  position over low-contrast texture, every piece read one file off
 *  at high confidence. */
function repairParity(img: GrayImage, box: BoardCorners): BoardCorners {
  const score = checkerboardScore(img, box.x0, box.y0, box.x1, box.y1);
  if (score >= 0) return box;
  const tile = Math.round((box.x1 - box.x0) / 8);
  let best = box;
  let bestScore = score;
  const shifts: Array<[number, number]> = [
    [tile, 0],
    [-tile, 0],
    [0, tile],
    [0, -tile],
  ];
  for (const [sx, sy] of shifts) {
    const c = { x0: box.x0 + sx, y0: box.y0 + sy, x1: box.x1 + sx, y1: box.y1 + sy };
    const s = checkerboardScore(img, c.x0, c.y0, c.x1, c.y1);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

export function findChessboardCorners(img: GrayImage): BoardCorners | null {
  const gradY = gradientRows(img);
  const gradX = gradientCols(img);
  const houghRows = houghResponse(gradY, img.width, img.height, "rows");
  const houghCols = houghResponse(gradX, img.width, img.height, "cols");

  // Rows hough peaks = y coordinates of horizontal lines;
  // cols hough peaks = x coordinates of vertical lines.
  const candidatesY = rankedPeakSequences(houghRows);
  const candidatesX = rankedPeakSequences(houghCols);
  const linesY = candidatesY[0]?.trimmed ?? null;
  const linesX = candidatesX[0]?.trimmed ?? null;

  // One axis clean, the other lost to low contrast / piece-edge noise:
  // rebuild the square board from the good axis. snapCorners (called by
  // the recognizer) then refines the alignment a few pixels either way.
  if (linesX && !linesY) {
    const r = reconstructFromCandidates(img, candidatesX, "x");
    return r ? repairParity(img, r) : null;
  }
  if (linesY && !linesX) {
    const r = reconstructFromCandidates(img, candidatesY, "y");
    return r ? repairParity(img, r) : null;
  }
  if (!linesX || !linesY) return null;

  const dx = median(linesX.slice(1).map((v, i) => v - linesX[i]));
  const dy = median(linesY.slice(1).map((v, i) => v - linesY[i]));

  // Sequences of 7-9 lines give up to 3x3 candidate 7-line sub-grids;
  // pick the one whose outer box correlates best with a checkerboard.
  const subX: number[][] = [];
  for (let k = 0; k + 7 <= linesX.length; k++) subX.push(linesX.slice(k, k + 7));
  const subY: number[][] = [];
  for (let k = 0; k + 7 <= linesY.length; k++) subY.push(linesY.slice(k, k + 7));

  let best: BoardCorners | null = null;
  let bestScore = -Infinity;
  for (const sx of subX) {
    for (const sy of subY) {
      const x0 = Math.round(sx[0] - dx);
      const x1 = Math.round(sx[6] + dx);
      const y0 = Math.round(sy[0] - dy);
      const y1 = Math.round(sy[6] + dy);
      const score = checkerboardScore(img, x0, y0, x1, y1);
      if (score > bestScore) {
        bestScore = score;
        best = { x0, y0, x1, y1 };
      }
    }
  }
  return best ? repairParity(img, best) : null;
}
