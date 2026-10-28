/**
 * The opt-in "Analyze in Kibitzo" button on chess.com and Lichess game
 * pages. Off by default: FenShot keeps no host access until the user turns
 * this on, and then only for these two sites. The registered content
 * script (site-button.js) only adds a link; the game itself is fetched by
 * kibitzo.com, so the extension never reads site data.
 */

export const SITE_ORIGINS = ["https://www.chess.com/*", "https://lichess.org/*"];
const SCRIPT_ID = "kibitzo-site-button";
const SCRIPT_FILE = "site-button.js";

export function siteButtonGranted(): Promise<boolean> {
  return chrome.permissions.contains({ origins: SITE_ORIGINS });
}

/** Make the registered script match the granted access (both directions). */
export async function syncSiteButton(): Promise<boolean> {
  const granted = await siteButtonGranted();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (granted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches: SITE_ORIGINS, js: [SCRIPT_FILE], runAt: "document_idle", persistAcrossSessions: true },
    ]);
  } else if (!granted && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return granted;
}

/** Already open game tabs get the button now, without a reload. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: SITE_ORIGINS });
  await Promise.allSettled(
    tabs.filter((t) => t.id !== undefined).map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: [SCRIPT_FILE] })),
  );
}

/** Must run from a user gesture (the popup click). */
export async function enableSiteButton(): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: SITE_ORIGINS });
  if (!granted) return false;
  await syncSiteButton();
  await injectIntoOpenTabs();
  return true;
}

/** Runs in the content script's world: remove the button and stop watching. */
function stopSiteButton() {
  (globalThis as typeof globalThis & { __kibitzoSiteButtonStop?: () => void }).__kibitzoSiteButtonStop?.();
}

export async function disableSiteButton(): Promise<void> {
  // Open tabs first, while we still have access to them: afterwards the
  // button would linger until each page reloads.
  const tabs = await chrome.tabs.query({ url: SITE_ORIGINS }).catch(() => []);
  await Promise.allSettled(
    tabs.filter((t) => t.id !== undefined).map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, func: stopSiteButton })),
  );
  await chrome.permissions.remove({ origins: SITE_ORIGINS });
  await syncSiteButton();
}
