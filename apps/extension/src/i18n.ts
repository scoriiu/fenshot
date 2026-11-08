import en from "../public/_locales/en/messages.json";

export type MessageKey = keyof typeof en;

type Message = { message: string; placeholders?: Record<string, { content: string }> };

/** The browser's language (chrome.i18n picks the _locales/<lang> that
 *  matches, else en). English from the bundled file when the API is not
 *  there (unit tests, a page context), so a key is never shown. */
export function t(key: MessageKey, ...subs: string[]): string {
  const fromBrowser = globalThis.chrome?.i18n?.getMessage?.(key, subs);
  if (fromBrowser) return fromBrowser;
  const m = en[key] as Message;
  return m.message.replace(/\$([A-Za-z_]+)\$/g, (whole, name: string) => {
    const content = m.placeholders?.[name.toLowerCase()]?.content;
    const index = content?.match(/^\$(\d)$/)?.[1];
    return index ? (subs[Number(index) - 1] ?? whole) : whole;
  });
}

/** lang/dir on the popup page, so fa/ar lay out right to left. */
export function applyDocumentLanguage(doc: Document) {
  const i18n = globalThis.chrome?.i18n;
  if (!i18n?.getUILanguage) return;
  doc.documentElement.lang = i18n.getUILanguage();
  doc.documentElement.dir = i18n.getMessage("@@bidi_dir") || "ltr";
}
