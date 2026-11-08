// What is left to translate after an English edit.
//   node scripts/i18n-todo.mjs --prune     drop stale keys in every language
//   node scripts/i18n-todo.mjs es          missing segments for es, as JSON
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "./i18n-lib.mjs";

const WEB = new URL("..", import.meta.url).pathname;
const source = JSON.parse(readFileSync(join(WEB, "i18n/source.json"), "utf8"));
const file = (code) => join(WEB, "i18n/content", `${code}.json`);

if (process.argv[2] === "--prune") {
  for (const { code } of LOCALES.filter((l) => l.code !== "en")) {
    if (!existsSync(file(code))) continue;
    const content = JSON.parse(readFileSync(file(code), "utf8"));
    const kept = Object.fromEntries(Object.entries(content).filter(([k]) => source[k]));
    writeFileSync(file(code), JSON.stringify(kept, null, 2) + "\n");
    console.log(`${code}: removed ${Object.keys(content).length - Object.keys(kept).length} stale`);
  }
} else {
  const code = process.argv[2];
  const content = existsSync(file(code)) ? JSON.parse(readFileSync(file(code), "utf8")) : {};
  const todo = Object.fromEntries(Object.entries(source).filter(([k]) => !content[k]).map(([k, v]) => [k, { text: v.text, kind: v.kind, pages: v.pages }]));
  console.log(JSON.stringify(todo, null, 2));
}
