// After `vite build`: every page in every language, from the English
// pages in dist and the translations in i18n/content/<code>.json.
//
//   dist/<page>              English, plus hreflang + language picker
//   dist/<code>/<page>       translated: lang/dir, canonical, internal
//                            links into the same language, picker
//   dist/sitemap.xml         every URL with its hreflang alternates
//
// A missing translation fails the build (I18N_ALLOW_MISSING=1 falls back
// to English for a work-in-progress preview).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOCALES, flushJsonLd, parseHtml, walk } from "./i18n-lib.mjs";

const WEB = new URL("..", import.meta.url).pathname;
const DIST = join(WEB, "dist");
const SITE = "https://fenshot.com";
const ALLOW_MISSING = process.env.I18N_ALLOW_MISSING === "1";
const today = new Date().toISOString().slice(0, 10);

const codes = LOCALES.map((l) => l.code);
const pages = ["/"];
for (const d of readdirSync(DIST, { withFileTypes: true })) {
  if (d.isDirectory() && !codes.includes(d.name) && existsSync(join(DIST, d.name, "index.html"))) pages.push(`/${d.name}/`);
}
const urlOf = (code, page) => (code === "en" ? page : `/${code}${page}`);
const fileOf = (code, page) => join(DIST, urlOf(code, page), "index.html");

function translations(code) {
  if (code === "en") return null;
  const f = join(WEB, "i18n/content", `${code}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
}

const PICKER_CSS = `<style id="fs-lang-css">
.fs-lang{position:absolute;top:16px;inset-inline-end:16px;z-index:20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.fs-lang summary{list-style:none;cursor:pointer;color:#94a3b8;font-size:14px;border:1px solid #263243;padding:6px 12px;border-radius:8px;background:#0c1117;user-select:none}
.fs-lang summary::-webkit-details-marker{display:none}
.fs-lang summary:hover,.fs-lang[open] summary{color:#e2e8f0;border-color:#94a3b8}
.fs-lang ul{position:absolute;inset-inline-end:0;top:calc(100% + 6px);margin:0;padding:6px;list-style:none;min-width:190px;max-height:70vh;overflow-y:auto;background:#131923;border:1px solid #263243;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
.fs-lang li{margin:0}
.fs-lang a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:7px;color:#e2e8f0;font-size:14px;text-decoration:none}
.fs-lang a:hover{background:rgba(148,163,184,.12)}
.fs-lang a[aria-current=true]{color:#f59e0b}
[dir=rtl] ul,[dir=rtl] ol{padding-left:0;padding-right:20px}
</style>`;

function picker(code, page) {
  const here = LOCALES.find((l) => l.code === code);
  const items = LOCALES.map((l) =>
    `<li><a href="${urlOf(l.code, page)}" hreflang="${l.code}" lang="${l.code}"${l.code === code ? ' aria-current="true"' : ""}><span aria-hidden="true">${l.flag}</span> ${l.name}</a></li>`,
  ).join("");
  return `<details class="fs-lang" translate="no"><summary><span aria-hidden="true">${here.flag}</span> ${code.toUpperCase()}</summary><ul>${items}</ul></details>`;
}

function hreflang(page) {
  const alts = LOCALES.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${urlOf(l.code, page)}" />`);
  alts.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${page}" />`);
  return alts.join("\n");
}

function isPagePath(href) {
  const path = href.split(/[?#]/)[0];
  return pages.includes(path) || pages.includes(path + "/");
}

const missing = new Map();

function render(code, page, englishHtml) {
  const root = parseHtml(englishHtml);
  const dict = translations(code);
  if (dict) {
    walk(root, ({ key, text, apply }) => {
      if (dict[key]) apply(dict[key]);
      else missing.set(`${code} ${key}`, text);
    });
    flushJsonLd(root);
  }
  const loc = LOCALES.find((l) => l.code === code);
  const html = root.querySelector("html");
  html.setAttribute("lang", code);
  html.setAttribute("dir", loc.dir);
  const head = root.querySelector("head");
  head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((n) => n.remove());
  head.querySelector("#fs-lang-css")?.remove();
  head.querySelector('link[rel="canonical"]')?.setAttribute("href", `${SITE}${urlOf(code, page)}`);
  head.querySelector('meta[property="og:url"]')?.setAttribute("content", `${SITE}${urlOf(code, page)}`);
  head.querySelector('meta[property="og:locale"]')?.remove();
  head.insertAdjacentHTML("beforeend", `\n<meta property="og:locale" content="${loc.og}" />\n${hreflang(page)}\n${PICKER_CSS}\n`);

  if (code !== "en") {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href.startsWith("/") && !href.startsWith("//") && isPagePath(href)) a.setAttribute("href", `/${code}${href}`);
    });
  }
  const body = root.querySelector("body");
  body.querySelector(".fs-lang")?.remove();
  if (page === "/") {
    // The home page is the React app, which renders its own picker; it
    // learns its language here. Assets are ./-relative (vite base "./"),
    // which breaks one directory down, so they become root-relative.
    head.insertAdjacentHTML("afterbegin", `<script>window.__FENSHOT_LANG__=${JSON.stringify(code)}</script>`);
  } else {
    body.insertAdjacentHTML("afterbegin", picker(code, page));
  }
  let out = root.toString();
  if (code !== "en" && page === "/") out = out.replace(/(src|href)="\.\//g, '$1="/');
  return out;
}

for (const page of pages) {
  const english = readFileSync(fileOf("en", page), "utf8");
  for (const code of codes) {
    const out = render(code, page, english);
    mkdirSync(dirname(fileOf(code, page)), { recursive: true });
    writeFileSync(fileOf(code, page), out);
  }
}

const urls = pages.map((page) => {
  const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${urlOf(l.code, page)}"/>`).join("\n")
    + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${page}"/>`;
  return LOCALES.map((l) => `  <url>\n    <loc>${SITE}${urlOf(l.code, page)}</loc><lastmod>${today}</lastmod>\n${alts}\n  </url>`).join("\n");
});
writeFileSync(join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`);

const missingByLang = {};
for (const k of missing.keys()) missingByLang[k.split(" ")[0]] = (missingByLang[k.split(" ")[0]] ?? 0) + 1;
console.log(`i18n: ${pages.length} pages x ${codes.length} languages = ${pages.length * codes.length} files, sitemap with ${pages.length * codes.length} URLs`);
if (missing.size) {
  console.log(`i18n: missing translations ${JSON.stringify(missingByLang)}`);
  if (!ALLOW_MISSING) {
    console.error("i18n: build stopped, run node scripts/i18n-check.mjs (or I18N_ALLOW_MISSING=1 for a preview)");
    process.exit(1);
  }
}
