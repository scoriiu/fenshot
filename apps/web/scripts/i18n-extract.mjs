// English HTML -> i18n/source.json (key -> text + the pages using it).
// The English pages stay the single source; translators work from this
// catalog. Run after editing any English page:  node scripts/i18n-extract.mjs
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtml, walk } from "./i18n-lib.mjs";

const WEB = new URL("..", import.meta.url).pathname;

export function englishPages() {
  const pages = [{ path: "/", file: join(WEB, "index.html") }];
  for (const d of readdirSync(join(WEB, "public"), { withFileTypes: true })) {
    const f = join(WEB, "public", d.name, "index.html");
    if (d.isDirectory() && existsSync(f)) pages.push({ path: `/${d.name}/`, file: f });
  }
  return pages;
}

const catalog = {};
for (const { path, file } of englishPages()) {
  walk(parseHtml(readFileSync(file, "utf8")), ({ key, text }) => {
    catalog[key] ??= { text, pages: [] };
    if (!catalog[key].pages.includes(path)) catalog[key].pages.push(path);
  });
}
const sorted = Object.fromEntries(Object.entries(catalog).sort(([, a], [, b]) => a.pages[0].localeCompare(b.pages[0])));
writeFileSync(join(WEB, "i18n/source.json"), JSON.stringify(sorted, null, 2) + "\n");
const words = Object.values(sorted).reduce((n, s) => n + s.text.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length, 0);
console.log(`${Object.keys(sorted).length} segments, ~${words} words, from ${englishPages().length} pages`);
