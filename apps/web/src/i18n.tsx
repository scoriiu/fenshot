import { createContext, useContext } from "react";
import en from "../i18n/ui/en.json";
import locales from "../i18n/locales.json";

export type Strings = typeof en;
export type Locale = (typeof locales)[number];
export { locales };

/** The page's language: set by the build on /<code>/ pages
 *  (scripts/i18n-build.mjs); ?lang= works in dev, where those pages do not
 *  exist. English otherwise. */
export function currentLang(): string {
  const w = window as unknown as { __FENSHOT_LANG__?: string };
  const fromDev = import.meta.env.DEV ? new URLSearchParams(location.search).get("lang") : null;
  const code = w.__FENSHOT_LANG__ ?? fromDev ?? "en";
  return locales.some((l) => l.code === code) ? code : "en";
}

const loaders = import.meta.glob<{ default: Partial<Strings> }>("../i18n/ui/*.json");

/** English is bundled; another language loads its one small file. A missing
 *  string falls back to English rather than showing a key. */
export async function loadStrings(code: string): Promise<Strings> {
  if (code === "en") return en;
  const load = loaders[`../i18n/ui/${code}.json`];
  return load ? { ...en, ...(await load()).default } : en;
}

export const StringsContext = createContext<Strings>(en);

export function useT() {
  const s = useContext(StringsContext);
  return (key: keyof Strings, vars?: Record<string, string | number>) =>
    s[key].replace(/\{(\w+)\}/g, (m, v: string) => (vars && v in vars ? String(vars[v]) : m));
}

/** Home URL of a language: / for English, /<code>/ otherwise. */
export const homeOf = (code: string) => (code === "en" ? "/" : `/${code}/`);
