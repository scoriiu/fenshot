/**
 * Scores the shipping recognizer on the benchmark built by build.ts.
 *
 *   npx tsx tools/benchmark/run.ts [--cases tools/benchmark/cases.json] [--images .tmp/benchmark/images]
 *
 * Runs the same pipeline the website and the extension run (recognizeGray:
 * detect, arbitrate, classify, rescan; the confidence floor that decides
 * whether the user is warned) with the shipping model, and writes
 * results.json next to the cases: one line per image, plus the summary the
 * accuracy page shows.
 *
 * Outcomes for an image with a board:
 *   exact           every square right, no warning
 *   exact-warned    every square right, but the user is told to check
 *   wrong-warned    some square wrong, and the user is told to check
 *   wrong-silent    some square wrong, no warning (the failure that matters)
 *   missed          no board found
 * For an image without a board:
 *   rejected        no board found (web app), or an impossible read the extension discards
 *   warned          a board is claimed, with a warning
 *   false-board     a board is claimed with no warning
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { recognizeGray, rgbaToGray, extractTiles, probsToPlacement, flipPlacement, resolveOrientation, type BoardCorners } from "@scoriiu/fenshot";
import type { Case } from "./build";

const MODEL = "packages/fenshot/model/chess-tiles-v2.onnx";
const MAX_DETECT_DIM = 1600;
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const CASES = arg("--cases", "tools/benchmark/cases.json");
const IMAGES = arg("--images", ".tmp/benchmark/images");
const OUT = arg("--out", join(dirname(CASES), "results.json"));

type Outcome = "exact" | "exact-warned" | "wrong-warned" | "wrong-silent" | "missed" | "rejected" | "warned" | "false-board";

async function loadGray(path: string) {
  const img = sharp(path, { animated: false });
  const meta = await img.metadata();
  const scale = Math.min(1, MAX_DETECT_DIM / Math.max(meta.width || 1, meta.height || 1));
  const w = Math.round((meta.width || 1) * scale);
  const h = Math.round((meta.height || 1) * scale);
  const rgba = await sharp(path, { animated: false }).resize(w, h).ensureAlpha().raw().toBuffer();
  return rgbaToGray(new Uint8ClampedArray(rgba), w, h);
}

function wrongSquares(got: string, want: string): string[] {
  const expand = (p: string) => p.split("/").map((row) => row.replace(/\d/g, (d) => "1".repeat(parseInt(d, 10))));
  const g = expand(got);
  const w = expand(want);
  const wrong: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (g[r]?.[f] !== w[r][f]) wrong.push(`${String.fromCharCode(97 + f)}${8 - r}:${g[r]?.[f] ?? "?"}>${w[r][f]}`);
    }
  }
  return wrong;
}

interface Scored { file: string; source: string; outcome: Outcome; wrong: string[]; minConfidence: number | null; ms: number }

async function score(session: ort.InferenceSession, c: Case): Promise<Scored> {
  const t0 = performance.now();
  const gray = await loadGray(join(IMAGES, c.file));
  const classify = async (corners: BoardCorners) => {
    const out = await session.run({ tiles: new ort.Tensor("float32", extractTiles(gray, corners), [64, 1024]) });
    return probsToPlacement(out.probs.data as Float32Array);
  };
  const result = await recognizeGray(gray, classify);
  const ms = Math.round(performance.now() - t0);
  const base = { file: c.file, source: c.source, ms };
  if (c.placement === null) {
    const outcome: Outcome = !result || !result.plausible ? "rejected" : result.reliable ? "false-board" : "warned";
    return { ...base, outcome, wrong: [], minConfidence: result?.minConfidence ?? null };
  }
  if (!result) return { ...base, outcome: "missed", wrong: [], minConfidence: null };
  const placement = resolveOrientation(result.placement).orientation === "black" ? flipPlacement(result.placement) : result.placement;
  const wrong = wrongSquares(placement, c.placement);
  const outcome: Outcome = wrong.length === 0 ? (result.reliable ? "exact" : "exact-warned") : result.reliable ? "wrong-silent" : "wrong-warned";
  return { ...base, outcome, wrong, minConfidence: Number(result.minConfidence.toFixed(4)) };
}

function tally(rows: Scored[]) {
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const outcomes = ["exact", "exact-warned", "wrong-warned", "wrong-silent", "missed", "rejected", "warned", "false-board"] as Outcome[];
  return { images: rows.length, ...Object.fromEntries(outcomes.map((o) => [o, count(o)]).filter(([, n]) => (n as number) > 0)) };
}

function summarize(cases: Case[], rows: Scored[]) {
  const byFile = new Map(cases.map((c) => [c.file, c]));
  const group = (key: (c: Case) => string | null) => {
    const groups: Record<string, Scored[]> = {};
    for (const r of rows) {
      const k = key(byFile.get(r.file)!);
      if (k !== null) (groups[k] ??= []).push(r);
    }
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, tally(v)]));
  };
  const positives = rows.filter((r) => byFile.get(r.file)!.placement !== null);
  return {
    model: MODEL,
    withBoard: tally(positives),
    withoutBoard: tally(rows.filter((r) => byFile.get(r.file)!.placement === null)),
    bySource: group((c) => c.source),
    byPhase: group((c) => c.phase),
    byTraining: group((c) => (c.seenInTraining === null ? null : c.seenInTraining ? "artwork seen in training" : "artwork never seen in training")),
    medianMs: positives.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(positives.length / 2)] ?? null,
  };
}

async function main() {
  const { built, cases } = JSON.parse(readFileSync(CASES, "utf8")) as { built: string; cases: Case[] };
  const session = await ort.InferenceSession.create(readFileSync(MODEL).buffer as ArrayBuffer, { executionProviders: ["wasm"] });
  const rows: Scored[] = [];
  for (const c of cases) {
    const r = await score(session, c);
    rows.push(r);
    if (r.outcome !== "exact" && r.outcome !== "rejected") console.log(r.outcome.padEnd(13), c.file, r.minConfidence ?? "", r.wrong.slice(0, 6).join(" "));
  }
  const summary = summarize(cases, rows);
  writeFileSync(OUT, JSON.stringify({ built, scored: new Date().toISOString().slice(0, 10), summary, results: rows }, null, 1) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main();
