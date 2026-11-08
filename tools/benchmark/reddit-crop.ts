// Crops each sampled Reddit image to its board for the eye check, using only
// fenshot's board LOCATOR (findChessboardCorners), never its piece reader, so
// the check stays blind to fenshot's answer. No board located = full image.
//
//   npx tsx tools/benchmark/reddit-crop.ts
import { readFileSync } from "fs";
import sharp from "sharp";
import { findChessboardCorners, rgbaToGray } from "@scoriiu/fenshot";

const DIR = ".tmp/benchmark/reddit";
const sample: { file: string }[] = JSON.parse(readFileSync(`${DIR}/sample.json`, "utf8"));

for (const c of sample) {
  const path = `${DIR}/${c.file}`;
  const meta = await sharp(path).metadata();
  const W = meta.width!, H = meta.height!;
  const scale = Math.min(1, 1600 / Math.max(W, H));
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const rgba = await sharp(path).resize(w, h).ensureAlpha().raw().toBuffer();
  const corners = findChessboardCorners(rgbaToGray(new Uint8ClampedArray(rgba), w, h));
  const out = `${DIR}/crop-${c.file.replace(/\.\w+$/, ".png")}`;
  if (!corners) {
    await sharp(path).png().toFile(out);
    console.log("full", c.file);
    continue;
  }
  const pad = (corners.x1 - corners.x0) * 0.06;
  const left = Math.max(0, Math.floor((corners.x0 - pad) / scale));
  const top = Math.max(0, Math.floor((corners.y0 - pad) / scale));
  const right = Math.min(W, Math.ceil((corners.x1 + pad) / scale));
  const bottom = Math.min(H, Math.ceil((corners.y1 + pad) / scale));
  await sharp(path).extract({ left, top, width: right - left, height: bottom - top }).png().toFile(out);
}
