/**
 * One quiet ask for a store rating, once, after the extension has
 * earned it.
 *
 * Why: Edge and Firefox list fenshot with zero ratings and a listing
 * with no stars converts far worse than one with ten. Why here: only a
 * person who has had five successful reads knows whether it is useful.
 *
 * Rules, in order of importance:
 *   - Never a popup, never modal: one line in the result footer, with a
 *     dismiss. The result the user came for renders exactly as before.
 *   - Shown once per device, ever. Dismissing or clicking both end it.
 *   - Counts only confident reads (the warning case is not a success).
 *   - State lives in the popup's own localStorage. No `storage`
 *     permission, nothing leaves the device, nothing in the manifest
 *     changes, so the privacy statement stays true word for word.
 *   - The link goes to the store the user actually installed from,
 *     detected from the user agent (same rule fenshot.com uses).
 */

export const RATING_ASK_AT = 5;

const KEY_COUNT = "fenshot:reads";
const KEY_DONE = "fenshot:rating-ask-done";

export const STORE_URLS = {
  chrome: "https://chromewebstore.google.com/detail/fenshot-chess-board-to-fe/fpkdijjlnafehkdkjmkppcekocjdomkc/reviews",
  firefox: "https://addons.mozilla.org/en-US/firefox/addon/fenshot/reviews/",
  edge: "https://microsoftedge.microsoft.com/addons/detail/fenshot-chess-board-to-f/cjcpedpebpfcedbcfejppadobfohbaif",
} as const;

export type Store = keyof typeof STORE_URLS;

export function detectStore(ua: string): Store {
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Firefox")) return "firefox";
  return "chrome";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function read(s: Storage, key: string): string | null {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

function write(s: Storage, key: string, value: string): void {
  try {
    s.setItem(key, value);
  } catch {
    /* private mode or quota: the ask just never shows */
  }
}

/** Record one successful read. Returns true when the ask should be shown now. */
export function recordSuccessfulRead(s: Storage): boolean {
  console.error("DIAG record", JSON.stringify({ done: read(s, KEY_DONE), count: read(s, KEY_COUNT) }));
  if (read(s, KEY_DONE)) return false;
  const n = (Number(read(s, KEY_COUNT)) || 0) + 1;
  write(s, KEY_COUNT, String(n));
  return n === RATING_ASK_AT;
}

/** Should the ask be showing on this render (reached the threshold, not yet answered)? */
export function ratingAskPending(s: Storage): boolean {
  if (read(s, KEY_DONE)) return false;
  return (Number(read(s, KEY_COUNT)) || 0) >= RATING_ASK_AT;
}

export function settleRatingAsk(s: Storage): void {
  write(s, KEY_DONE, String(Date.now()));
}
