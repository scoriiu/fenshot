// Every language against the English source. Exit 1 on any problem.
//   node scripts/i18n-check.mjs            all languages
//   node scripts/i18n-check.mjs es de      some
// Pages: i18n/content/<code>.json vs i18n/source.json (run i18n-extract
// first). UI: i18n/ui/<code>.json vs i18n/ui/en.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, shape } from "./i18n-lib.mjs";

const WEB = new URL("..", import.meta.url).pathname;
const read = (f) => JSON.parse(readFileSync(join(WEB, f), "utf8"));
const source = read("i18n/source.json");
const uiEn = read("i18n/ui/en.json");
const only = process.argv.slice(2);
const codes = LOCALES.map((l) => l.code).filter((c) => c !== "en" && (!only.length || only.includes(c)));

const vars = (s) => JSON.stringify([...s.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort());
let problems = 0;
const warnings = [];
const report = (code, msg) => { problems++; console.log(`  ${code}: ${msg}`); };

for (const code of codes) {
  const contentFile = `i18n/content/${code}.json`;
  const uiFile = `i18n/ui/${code}.json`;
  const content = existsSync(join(WEB, contentFile)) ? read(contentFile) : {};
  const ui = existsSync(join(WEB, uiFile)) ? read(uiFile) : {};
  const before = problems;

  const missing = Object.keys(source).filter((k) => !content[k]);
  if (missing.length) report(code, `${missing.length} page segments missing (first: ${missing[0]} "${source[missing[0]].text.slice(0, 60)}")`);
  const stale = Object.keys(content).filter((k) => !source[k]);
  if (stale.length) report(code, `${stale.length} stale page segments (English changed; delete or retranslate): ${stale.slice(0, 5).join(", ")}`);
  for (const [k, t] of Object.entries(content)) {
    if (!source[k]) continue;
    if (shape(t) !== shape(source[k].text)) report(code, `${k} lost or changed a tag/link/placeholder:\n      en: ${source[k].text.slice(0, 140)}\n      ${code}: ${t.slice(0, 140)}`);
    if (/—/.test(t)) report(code, `${k} uses an em dash`);
    // Search results cut longer titles and descriptions (CJK characters
    // are about twice as wide). A warning, not a failure: the full text
    // still reaches crawlers.
    const limit = { title: 70, description: 170 }[source[k].kind];
    const width = [...t].reduce((n, ch) => n + (/[\u3000-\u9fff\uac00-\ud7af]/.test(ch) ? 2 : 1), 0);
    if (limit && width > limit) warnings.push(`${code} ${source[k].kind} ${width}/${limit}: ${t.slice(0, 80)}`);
  }

  const uiMissing = Object.keys(uiEn).filter((k) => uiEn[k] !== "" && !ui[k]);
  if (uiMissing.length) report(code, `${uiMissing.length} UI strings missing: ${uiMissing.join(", ")}`);
  for (const [k, t] of Object.entries(ui)) {
    if (!(k in uiEn)) report(code, `UI key ${k} does not exist in en.json`);
    else if (vars(t) !== vars(uiEn[k])) report(code, `UI ${k} placeholders ${vars(t)} != ${vars(uiEn[k])}`);
  }
  console.log(`${code}: ${problems === before ? "OK" : `${problems - before} problem(s)`}`);
}
if (warnings.length) console.log(`\n${warnings.length} length warning(s), shown cut in search results:\n  ${warnings.join("\n  ")}`);
console.log(problems ? `\n${problems} problem(s)` : "\nall languages complete");
process.exit(problems ? 1 : 0);
