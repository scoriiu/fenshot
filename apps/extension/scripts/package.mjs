// One build, one zip per browser family. The manifests differ only in
// "background": Firefox runs background scripts (no extension service
// workers); Edge rejects "background.scripts" in MV3 outright, and Chrome
// only tolerates it with a warning. So:
//   fenshot-extension-<v>-chromium.zip  Chrome Web Store + Edge: service_worker only
//   fenshot-extension-<v>-firefox.zip   AMO: dist/ as built (scripts + service_worker,
//                                       the shape the AMO build instructions reproduce)
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const zip = (dir, out) => {
  rmSync(out, { force: true });
  execFileSync("find", [".", "-name", ".DS_Store", "-delete"], { cwd: dir });
  execFileSync("zip", ["-qr", `../${out}`, ".", "-x", ".*", "*/.*"], { cwd: dir });
  console.log("packaged:", out);
};

zip("dist", `fenshot-extension-${version}-firefox.zip`);

rmSync("dist-chromium", { recursive: true, force: true });
cpSync("dist", "dist-chromium", { recursive: true });
const manifest = JSON.parse(readFileSync("dist-chromium/manifest.json", "utf8"));
manifest.background = { service_worker: manifest.background.service_worker };
delete manifest.browser_specific_settings;
writeFileSync("dist-chromium/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
zip("dist-chromium", `fenshot-extension-${version}-chromium.zip`);
rmSync("dist-chromium", { recursive: true, force: true });
