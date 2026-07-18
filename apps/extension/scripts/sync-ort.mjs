// Copies the onnxruntime-web wasm runtime into src/ort/ (gitignored).
// The package's exports map hides dist/*, and its physical location
// depends on npm hoisting, so resolve it and copy: deterministic for
// dev, build, and CI alike.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// exports map hides package.json; resolve the entry (lives in dist/).
const ortDist = dirname(require.resolve("onnxruntime-web"));
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ort");

mkdirSync(dest, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  copyFileSync(join(ortDist, f), join(dest, f));
}
console.log(`[sync-ort] copied wasm runtime from ${ortDist}`);
