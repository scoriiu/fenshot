/**
 * Evaluates a tile-classifier ONNX model on REAL screenshots through
 * the full production pipeline (recognizeGray: detect -> arbitrate ->
 * classify -> fen, including the empty-board rescan).
 *
 *   npx tsx tools/tile-classifier/eval-real.ts [--model path.onnx]
 *
 * Default model: .tmp/tile-model/tilenet.onnx (a freshly trained
 * candidate). Pass --model packages/fenshot/model/chess-tiles-v2.onnx
 * to baseline the shipping model. Handles the legacy tensorflow_chessbot
 * tensor interface too, for baselining ancient models.
 *
 * Cases: packages/fenshot/tests/fixtures/* per testset-manifest.json.
 */

import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";


import { recognizeGray, rgbaToGray, extractTiles, probsToPlacement, flipPlacement, resolveOrientation, type BoardCorners } from "@scoriiu/fenshot";

const MAX_DETECT_DIM = 1600;
const FIXTURES = "packages/fenshot/tests/fixtures";

interface EvalCase {
  path: string;
  fen: string | null;
  label: string;
}

function buildCases(): EvalCase[] {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, "testset-manifest.json"), "utf8"));
  const cases: EvalCase[] = Object.entries(manifest).map(([file, info]) => ({
    path: join(FIXTURES, file),
    fen: (info as { fen: string }).fen,
    label: file,
  }));
  cases.push({ path: join(FIXTURES, "reddit-chrome-no-board.png"), fen: null, label: "reddit-chrome-no-board.png (negative)" });
  return cases;
}

async function loadGray(path: string) {
  const meta = await sharp(path).metadata();
  const scale = Math.min(1, MAX_DETECT_DIM / Math.max(meta.width || 1, meta.height || 1));
  const w = Math.round((meta.width || 1) * scale);
  const h = Math.round((meta.height || 1) * scale);
  const rgba = await sharp(path).resize(w, h).ensureAlpha().raw().toBuffer();
  return rgbaToGray(new Uint8ClampedArray(rgba), w, h);
}

async function runModel(session: ort.InferenceSession, tiles: Float32Array): Promise<Float32Array> {
  const legacy = session.inputNames.includes("Input:0");
  const feeds: Record<string, ort.Tensor> = legacy
    ? {
        "Input:0": new ort.Tensor("float32", tiles, [64, 1024]),
        "KeepProb:0": new ort.Tensor("float32", new Float32Array([1]), []),
      }
    : { tiles: new ort.Tensor("float32", tiles, [64, 1024]) };
  const out = await session.run(feeds);
  const outName = legacy ? "probabilities:0" : "probs";
  return out[outName].data as Float32Array;
}

function diffPlacements(got: string, want: string): string[] {
  const expand = (p: string) =>
    p.split("/").map((row) => row.replace(/\d/g, (d) => "1".repeat(parseInt(d, 10))));
  const g = expand(got);
  const w = expand(want);
  const wrong: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if (g[r][f] !== w[r][f]) {
        const square = String.fromCharCode(97 + f) + String(8 - r);
        wrong.push(`${square}: got ${g[r][f]} want ${w[r][f]}`);
      }
    }
  }
  return wrong;
}

async function main() {
  const modelArg = process.argv.indexOf("--model");
  const modelPath = modelArg > -1 ? process.argv[modelArg + 1] : ".tmp/tile-model/tilenet.onnx";
  console.log(`model: ${modelPath}\n`);
  const session = await ort.InferenceSession.create(readFileSync(modelPath).buffer as ArrayBuffer, {
    executionProviders: ["wasm"],
  });

  let pass = 0;
  let fail = 0;
  for (const c of buildCases()) {
    const gray = await loadGray(c.path);
    const classify = async (corners: BoardCorners) =>
      probsToPlacement(await runModel(session, extractTiles(gray, corners)));
    const result = await recognizeGray(gray, classify);
    if (!result) {
      const ok = c.fen === null;
      console.log(`${ok ? "PASS" : "FAIL"} ${c.label}: ${ok ? "correctly rejected" : "NO BOARD DETECTED"}`);
      ok ? pass++ : fail++;
      continue;
    }
    if (c.fen === null) {
      console.log(`FAIL ${c.label}: detected a board in a negative case`);
      fail++;
      continue;
    }
    const placement = resolveOrientation(result.placement).orientation === "black" ? flipPlacement(result.placement) : result.placement;
    const wrong = diffPlacements(placement, c.fen);
    const ok = wrong.length === 0;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.label}: minConf ${result.minConfidence.toFixed(3)}, wrong tiles ${wrong.length}`,
    );
    for (const w of wrong) console.log(`       ${w}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
