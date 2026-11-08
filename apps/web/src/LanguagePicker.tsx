import { homeOf, locales, useT } from "./i18n";

/** Flag + native name, one tap to open (founder 2026-11-08: easy to find,
 *  with the flag; no auto-detection). The same list the static pages get
 *  from scripts/i18n-build.mjs. */
export function LanguagePicker({ current }: { current: string }) {
  const t = useT();
  const here = locales.find((l) => l.code === current) ?? locales[0];
  return (
    <details className="lang-picker">
      <summary aria-label={t("language")}>
        <span aria-hidden>{here.flag}</span> {here.code.toUpperCase()}
      </summary>
      <ul>
        {locales.map((l) => (
          <li key={l.code}>
            <a href={homeOf(l.code)} hrefLang={l.code} lang={l.code} aria-current={l.code === current ? "true" : undefined}>
              <span aria-hidden>{l.flag}</span> {l.name}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
