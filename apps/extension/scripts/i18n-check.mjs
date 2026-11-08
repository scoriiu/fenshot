// Every _locales/<code>/messages.json against en. Exit 1 on any problem.
//   node scripts/i18n-check.mjs [codes...]
// Store limits: name 75 characters, short description 132 (Chrome Web
// Store; Edge and AMO allow more).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../public/_locales", import.meta.url).pathname;
const read = (code) => JSON.parse(readFileSync(join(DIR, code, "messages.json"), "utf8"));
const en = read("en");
const only = process.argv.slice(2);
const codes = readdirSync(DIR).filter((c) => c !== "en" && existsSync(join(DIR, c, "messages.json")) && (!only.length || only.includes(c)));
const vars = (s) => JSON.stringify([...s.matchAll(/\$[A-Za-z_]+\$/g)].map((m) => m[0].toUpperCase()).sort());
const LIMITS = { extName: 75, extDescription: 132 };

let problems = 0;
for (const code of codes) {
  const m = read(code);
  const issues = [];
  for (const k of Object.keys(en)) {
    const v = m[k]?.message;
    if (!v) { issues.push(`missing ${k}`); continue; }
    if (vars(v) !== vars(en[k].message)) issues.push(`${k} placeholders ${vars(v)} != ${vars(en[k].message)}`);
    if (en[k].placeholders && JSON.stringify(m[k].placeholders) !== JSON.stringify(Object.fromEntries(Object.entries(en[k].placeholders).map(([n, p]) => [n, { content: p.content, example: p.example }])))
      && !(m[k].placeholders && Object.keys(m[k].placeholders).every((n) => m[k].placeholders[n].content === en[k].placeholders[n]?.content))) issues.push(`${k} placeholders block must match en (content "$1")`);
    if (LIMITS[k] && [...v].length > LIMITS[k]) issues.push(`${k} is ${[...v].length} chars, store limit ${LIMITS[k]}`);
    if (/—/.test(v)) issues.push(`${k} uses an em dash`);
  }
  for (const k of Object.keys(m)) if (!(k in en)) issues.push(`unknown key ${k}`);
  problems += issues.length;
  console.log(`${code}: ${issues.length ? issues.length + " problem(s)\n    " + issues.join("\n    ") : "OK"}`);
}
console.log(problems ? `\n${problems} problem(s)` : `\n${codes.length} languages complete`);
process.exit(problems ? 1 : 0);
