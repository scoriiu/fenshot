// Shared by i18n-extract, i18n-check and i18n-build: one definition of
// what a translatable segment is, so the three can never disagree.
//
// A segment is (a) the innerHTML of a "leaf block": an element that holds
// text and only inline children (a, strong, kbd, ...), so a translator
// sees whole sentences with their links in place; (b) a translatable
// attribute (alt, aria-label, title, placeholder) or meta content
// (description, og:/twitter: title and description); (c) a string in
// JSON-LD (description, text, and a Question's name).
// Its key is a hash of the whitespace-normalized English text, so editing
// an English sentence turns its translations into "missing" in the check.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "node-html-parser";

export const LOCALES = JSON.parse(readFileSync(new URL("../i18n/locales.json", import.meta.url), "utf8"));

const INLINE = new Set(["a", "strong", "em", "b", "i", "kbd", "code", "span", "br", "small", "sup", "sub", "abbr", "mark", "u", "s", "time"]);
const SKIP = new Set(["script", "style", "svg", "noscript", "template"]);
const META = new Set(["description", "og:title", "og:description", "twitter:title", "twitter:description"]);
const ATTRS = ["alt", "aria-label", "title", "placeholder"];

export const normalize = (s) => s.replace(/\s+/g, " ").trim();
export const keyOf = (s) => createHash("sha1").update(normalize(s)).digest("hex").slice(0, 10);
const hasWords = (s) => /\p{L}/u.test(s);

export function parseHtml(html) {
  return parse(html, { comment: true, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
}

function isLeafBlock(el) {
  if (!hasWords(el.text)) return false;
  return el.querySelectorAll("*").every((d) => INLINE.has(d.rawTagName?.toLowerCase()) && !SKIP.has(d.rawTagName?.toLowerCase()));
}

/** Calls visit({ key, text, apply }) for every segment of `root`. */
export function walk(root, visit) {
  const seg = (text, apply, kind = "text") => {
    if (!text || !hasWords(text)) return;
    visit({ key: keyOf(text), text: normalize(text), apply, kind });
  };

  const visitEl = (el) => {
    const tag = el.rawTagName?.toLowerCase();
    if (!tag) { el.childNodes?.forEach((c) => c.nodeType === 1 && visitEl(c)); return; }
    if (tag === "script" && el.getAttribute("type") === "application/ld+json") return jsonLd(el, seg);
    if (SKIP.has(tag) || el.getAttribute("translate") === "no" || el.id === "root") return;
    if (tag === "meta") {
      const name = el.getAttribute("name") ?? el.getAttribute("property");
      if (META.has(name)) seg(el.getAttribute("content"), (t) => el.setAttribute("content", t), name === "description" ? "description" : "meta");
      return;
    }
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) seg(v, (t) => el.setAttribute(a, t));
    }
    if (!INLINE.has(tag) && isLeafBlock(el)) {
      seg(el.innerHTML, (t) => el.set_content(t), tag === "title" ? "title" : "text");
      return;
    }
    el.childNodes.forEach((c) => c.nodeType === 1 && visitEl(c));
  };
  visitEl(root);
}

function jsonLd(el, seg) {
  let data;
  try { data = JSON.parse(el.text); } catch { return; }
  const touch = (o) => {
    if (Array.isArray(o)) return o.forEach(touch);
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const translatable = k === "description" || k === "text" || (k === "name" && o["@type"] === "Question");
      if (translatable && typeof v === "string") seg(v, (t) => { o[k] = t; });
      else touch(v);
    }
  };
  touch(data);
  // Re-serialised after the walk's applies have run (see flushJsonLd).
  el.__jsonld = data;
}

export function flushJsonLd(root) {
  root.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    if (el.__jsonld) el.set_content("\n" + JSON.stringify(el.__jsonld, null, 2) + "\n");
  });
}

/** Tags and placeholders a translation must keep, as a comparable string. */
export function shape(html) {
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, " ").replace(/>\s*$/, ">")).sort();
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();
  const vars = [...html.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort();
  return JSON.stringify({ tags: tags.length, hrefs, vars });
}
