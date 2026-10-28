/**
 * Keeps the opt-in Kibitzo button's content script in step with the
 * user's site access. Needed because Firefox closes the popup while its
 * permission prompt is open, so the popup cannot finish the registration
 * itself; and because access can be revoked from the browser's own
 * extension settings, where the popup never runs.
 */

import { syncSiteButton } from "./site-access";

const sync = () => void syncSiteButton().catch(() => undefined);

chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);
