// For the disagreement check: where fenshot located the board, which way it
// decided the board faces, and what it read, per Reddit image that fenshot
// and the bot disagree on (or where fenshot found no board).
//
//   npx tsx tools/benchmark/reddit-dump.ts
import { readFileSync, writeFileSync } from "fs";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { recognizeGray, rgbaToGray, extractTiles, probsToPlacement, flipPlacement, resolveOrientation, type BoardCorners } from "@scoriiu/fenshot";

const DIR = ".tmp/benchmark/reddit";
const results = JSON.parse(readFileSync(`${DIR}/results-provisional.json`, "utf8")).results as { file: string; outcome: string; wrong: string[] }[];
const cases = JSON.parse(readFileSync(`${DIR}/cases-provisional.json`, "utf8")).cases as { file: string; placement: string }[];
const session = await ort.InferenceSession.create(readFileSync("packages/fenshot/model/chess-tiles-v2.onnx").buffer as ArrayBuffer, { executionProviders: ["wasm"] });

const out = [];
for (const r of results.filter((x) => x.outcome !== "exact" && x.outcome !== "exact-warned")) {
  const path = `${DIR}/${r.file}`;
  const meta = await sharp(path).metadata();
  const scale = Math.min(1, 1600 / Math.max(meta.width!, meta.height!));
  const w = Math.round(meta.width! * scale), h = Math.round(meta.height! * scale);
  const gray = rgbaToGray(new Uint8ClampedArray(await sharp(path).resize(w, h).ensureAlpha().raw().toBuffer()), w, h);
  const classify = async (c: BoardCorners) =>
    probsToPlacement((await session.run({ tiles: new ort.Tensor("float32", extractTiles(gray, c), [64, 1024]) })).probs.data as Float32Array);
  const res = await recognizeGray(gray, classify);
  const black = res ? resolveOrientation(res.placement).orientation === "black" : false;
  out.push({
    file: r.file,
    outcome: r.outcome,
    wrong: r.wrong,
    bot: cases.find((c) => c.file === r.file)!.placement,
    fenshot: res ? (black ? flipPlacement(res.placement) : res.placement) : null,
    black,
    corners: res ? { x0: res.corners.x0 / scale, y0: res.corners.y0 / scale, x1: res.corners.x1 / scale, y1: res.corners.y1 / scale } : null,
  });
}
writeFileSync(`${DIR}/disputes.json`, JSON.stringify(out, null, 1));
console.log(out.length, "disputes");
