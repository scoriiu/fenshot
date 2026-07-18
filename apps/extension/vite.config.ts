import { defineConfig } from "vite";

// Extension pages load from the extension root, so relative asset URLs
// are required. Everything (popup, wasm runtime, model) is emitted into
// dist/, which is what gets loaded unpacked / zipped for the stores.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
