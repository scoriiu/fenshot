import { defineConfig } from "vite";

// Content scripts and the background script cannot be ES-module chunks:
// each is built on its own as one self-contained IIFE file next to the
// popup build. SCRIPT picks the entry (site-button | background).
const name = process.env.SCRIPT ?? "site-button";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    lib: {
      entry: `src/${name}.ts`,
      formats: ["iife"],
      name: name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
      fileName: () => `${name}.js`,
    },
  },
});
