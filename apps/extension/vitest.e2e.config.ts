import { defineConfig } from "vitest/config";

// Browser-driven tests: one file at a time (each launches Chromium),
// generous timeouts (the popup runs the ONNX recognizer in WASM).
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
