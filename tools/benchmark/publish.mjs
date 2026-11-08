// Fills every number on fenshot.com/accuracy/ from results.json and
// reddit-results.json, the one source of truth. Numbers sit in their own
// elements (no letters), so a re-run never needs new translations.
//
//   node tools/benchmark/publish.mjs
import { readFileSync, writeFileSync } from "node:fs";

const PAGE = "apps/web/public/accuracy/index.html";
const bench = JSON.parse(readFileSync("tools/benchmark/results.json", "utf8"));
const reddit = JSON.parse(readFileSync("tools/benchmark/reddit-results.json", "utf8"));
const s = bench.summary;

const right = (t) => (t.exact ?? 0) + (t["exact-warned"] ?? 0);
const pct = (a, b) => `${Math.floor((1000 * a) / b) / 10}%`.replace(".0%", "%");
const sum = (...ts) => ts.reduce((acc, t) => {
  for (const [k, v] of Object.entries(t)) acc[k] = (acc[k] ?? 0) + v;
  return acc;
}, {});

const pages = sum(s.bySource["chesscom-page"], s.bySource["lichess-page"]);
const drawn = s.withBoard;
const wrong = (drawn["wrong-warned"] ?? 0) + (drawn["wrong-silent"] ?? 0);
const nb = s.withoutBoard;
const noFalse = nb.images - (nb["false-board"] ?? 0);
const r = reddit.summary;

const values = {
  "tile.pages.pct": pct(pages.exact ?? 0, pages.images),
  "tile.pages.n": `${pages.exact ?? 0} / ${pages.images}`,
  "tile.reddit.pct": pct(right(r), r.images),
  "tile.reddit.n": `${right(r)} / ${r.images}`,
  "tile.warned.pct": pct(drawn["wrong-warned"] ?? 0, wrong),
  "tile.warned.n": `${drawn["wrong-warned"] ?? 0} / ${wrong}`,
  "tile.noboard.pct": pct(noFalse, nb.images),
  "tile.noboard.n": `${noFalse} / ${nb.images}`,
  date: bench.scored,
  model: s.model.split("/").pop().replace(".onnx", ""),
  images: String(drawn.images + nb.images + r.images),
};
const rows = {
  ...Object.fromEntries(Object.entries(s.bySource).filter(([k]) => k !== "no-board")),
  reddit: r,
  seen: s.byTraining["artwork seen in training"],
  unseen: s.byTraining["artwork never seen in training"],
};
for (const [row, t] of Object.entries(rows)) {
  for (const col of ["images", "exact", "exact-warned", "wrong-warned", "wrong-silent", "missed"]) {
    values[`row.${row}.${col}`] = String(t[col] ?? 0);
  }
}

let html = readFileSync(PAGE, "utf8");
const used = new Set();
html = html.replace(/(<(\w+)[^>]*\sdata-bm="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, _tag, key, _old, close) => {
  if (!(key in values)) throw new Error(`no value for data-bm="${key}"`);
  used.add(key);
  return `${open}${values[key]}${close}`;
});
const unused = Object.keys(values).filter((k) => !used.has(k));
if (unused.length) throw new Error(`values with no element: ${unused.join(", ")}`);
writeFileSync(PAGE, html);

const LLMS = "apps/web/public/llms.txt";
const facts = [
  `- Measured ${values.date} on ${values.images} images with known positions (model ${values.model}); method, data and code: https://fenshot.com/accuracy/ and https://github.com/scoriiu/fenshot/tree/main/tools/benchmark`,
  `- chess.com and Lichess analysis pages in their default look, desktop and phone: ${values["tile.pages.n"]} read exactly right (${values["tile.pages.pct"]}).`,
  `- Real chess screenshots posted on Reddit: at least ${values["tile.reddit.n"]} read right (${values["tile.reddit.pct"]}); every disagreement with an independent reader counts as a fenshot error.`,
  (() => {
    const themed = sum(rows["chesscom-image"], rows["lichess-page-themed"]);
    return `- Other piece sets and boards (${themed.images} images, 24 piece sets, 22 boards, including 3D sets never seen in training): ${right(themed)} read right (${pct(right(themed), themed.images)}).`;
  })(),
  `- Over all ${drawn.images} images drawn by chess.com and Lichess, ${values["tile.warned.n"]} wrong reads came with a warning to check (${values["tile.warned.pct"]}); ${drawn["wrong-silent"] ?? 0} were wrong without one.`,
  `- Pages with no chess board: fenshot invented no position on ${values["tile.noboard.n"]}.`,
  "- Weak spots: 3D piece sets, print-style and textured boards (chess.com newspaper; Lichess marble, grey, purple), and unusual piece sets (Lichess horsey, cardinal, monarchy).",
];
const llms = readFileSync(LLMS, "utf8").replace(/<!-- benchmark:start -->[\s\S]*<!-- benchmark:end -->/, `<!-- benchmark:start -->\n${facts.join("\n")}\n<!-- benchmark:end -->`);
writeFileSync(LLMS, llms);
console.log(values);
