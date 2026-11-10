/**
 * Why did this image fail? For each failing benchmark case, compares the
 * production read against a read with the TRUE board corners, to separate
 * "the board was located wrong" from "the pieces were classified wrong".
 *
 *   npx tsx tools/benchmark/diagnose.ts                       # every non-exact drawn case
 *   npx tsx tools/benchmark/diagnose.ts --source chesscom-image
 *
 * True corners are known for chess.com board images (the image IS the
 * board, plus an optional coordinate margin) and are searched for on page
 * screenshots (the corner box, within a small window of the detected one,
 * whose read matches the truth best). Writes .tmp/benchmark/diagnosis.json.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { findChessboardCorners, snapCorners, rgbaToGray, extractTiles, probsToPlacement, flipPlacement, type BoardCorners, type GrayImage } from "@scoriiu/fenshot";
import type { Case } from "./build";

const IMAGES = ".tmp/benchmark/images";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const onlySource = arg("--source");

const { cases } = JSON.parse(readFileSync("tools/benchmark/cases.json", "utf8")) as { cases: Case[] };
const results = JSON.parse(readFileSync("tools/benchmark/results.json", "utf8")).results as { file: string; outcome: string }[];
const outcomeOf = new Map(results.map((r) => [r.file, r.outcome]));
const session = await ort.InferenceSession.create(readFileSync("packages/fenshot/model/chess-tiles-v2.onnx").buffer as ArrayBuffer, { executionProviders: ["wasm"] });

async function loadGray(path: string): Promise<GrayImage> {
  const meta = await sharp(path).metadata();
  const scale = Math.min(1, 1600 / Math.max(meta.width!, meta.height!));
  const w = Math.round(meta.width! * scale), h = Math.round(meta.height! * scale);
  return rgbaToGray(new Uint8ClampedArray(await sharp(path).resize(w, h).ensureAlpha().raw().toBuffer()), w, h);
}

async function read(gray: GrayImage, c: BoardCorners) {
  const out = await session.run({ tiles: new ort.Tensor("float32", extractTiles(gray, c), [64, 1024]) });
  return probsToPlacement(out.probs.data as Float32Array);
}

const expand = (p: string) => p.split("/").map((r) => r.replace(/\d/g, (d) => "1".repeat(+d))).join("");
/** Wrong squares against the truth, trying both orientations. */
function wrongCount(placement: string, truth: string): number {
  const t = expand(truth);
  const count = (p: string) => [...expand(p)].filter((ch, i) => ch !== t[i]).length;
  return Math.min(count(placement), count(flipPlacement(placement)));
}

const tile = (c: BoardCorners) => (c.x1 - c.x0) / 8;
const fmt = (c: BoardCorners) => `${c.x0.toFixed(0)},${c.y0.toFixed(0)} ${c.x1.toFixed(0)},${c.y1.toFixed(0)}`;

/** Best corner box near `start`: shifts of up to one tile in quarter-tile
 *  steps, at the detected size. Finds "right board, slid by a row". */
async function bestNearby(gray: GrayImage, start: BoardCorners, truth: string) {
  const t = tile(start);
  let best = { wrong: 65, dx: 0, dy: 0, minConf: 0 };
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const c = { x0: start.x0 + (dx * t) / 4, y0: start.y0 + (dy * t) / 4, x1: start.x1 + (dx * t) / 4, y1: start.y1 + (dy * t) / 4 };
      if (c.x0 < -t / 2 || c.y0 < -t / 2 || c.x1 > gray.width + t / 2 || c.y1 > gray.height + t / 2) continue;
      const r = await read(gray, c);
      const wrong = wrongCount(r.placement, truth);
      if (wrong < best.wrong) best = { wrong, dx: dx / 4, dy: dy / 4, minConf: r.minConfidence };
    }
  }
  return best;
}

const rows = [];
for (const c of cases) {
  const outcome = outcomeOf.get(c.file);
  if (!c.placement || outcome === "exact" || (onlySource && c.source !== onlySource)) continue;
  const gray = await loadGray(join(IMAGES, c.file));
  const detected = findChessboardCorners(gray);
  if (!detected) { rows.push({ file: c.file, source: c.source, config: c.config, outcome, cause: "no board detected" }); continue; }
  const snapped = snapCorners(gray, detected);
  const rDet = await read(gray, detected);
  const rSnap = await read(gray, snapped);
  const near = await bestNearby(gray, detected, c.placement);
  const wrongDet = wrongCount(rDet.placement, c.placement);
  const wrongSnap = wrongCount(rSnap.placement, c.placement);
  const picked = rSnap.meanConfidence > rDet.meanConfidence ? "snap" : "detected";
  const cause =
    near.wrong === 0 && (near.dx !== 0 || near.dy !== 0) ? `location: right read ${near.dx},${near.dy} tiles away`
    : near.wrong === 0 ? "arbitration: detected box reads right, another candidate won"
    : near.wrong <= 3 ? `classifier: ${near.wrong} squares wrong even at the best box`
    : `classifier or scale: ${near.wrong} squares wrong at the best nearby box`;
  rows.push({
    file: c.file, source: c.source, config: c.config, outcome, cause,
    image: `${gray.width}x${gray.height}`, detected: fmt(detected), snapped: fmt(snapped), tilePx: +tile(detected).toFixed(1),
    wrongDetected: wrongDet, wrongSnapped: wrongSnap, picked,
    confDetected: [+rDet.minConfidence.toFixed(3), +rDet.meanConfidence.toFixed(3)], confSnapped: [+rSnap.minConfidence.toFixed(3), +rSnap.meanConfidence.toFixed(3)],
    bestNearby: near,
  });
}
writeFileSync(".tmp/benchmark/diagnosis.json", JSON.stringify(rows, null, 1));

const by = new Map<string, number>();
for (const r of rows) {
  const k = `${r.source} | ${r.cause.replace(/[-\d.]+,[-\d.]+ tiles away/, "N tiles away").replace(/: \d+ squares/, ": N squares")}`;
  by.set(k, (by.get(k) ?? 0) + 1);
}
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
