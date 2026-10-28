/**
 * "Analyze in Kibitzo" on finished chess.com and Lichess games. Registered
 * only after the user opts in (site-access.ts). It reads nothing but the
 * game's id, the player names the page shows and the board's orientation,
 * and adds a plain link; kibitzo.com fetches the game itself.
 *
 * Fair play: the button is anchored ONLY in UI the sites render after a
 * game ends (chess.com's Game Review link, Lichess's post-game row or a
 * finished game's status line), and kibitzo.com refuses unfinished games
 * as a second gate. Nothing here runs a search or shows an evaluation.
 */

const ORIGIN = (import.meta.env.VITE_KIBITZO_ORIGIN as string | undefined) || "https://kibitzo.com";
const UTM = "utm_source=fenshot&utm_medium=extension&utm_campaign=site-button";
const MARK = "data-kibitzo-button";
const LABEL = "Analyze in Kibitzo";
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

/** Set while running; the stop hook lets the popup remove the button live (site-access.ts). */
type Guarded = typeof globalThis & { __kibitzoSiteButton?: boolean; __kibitzoSiteButtonStop?: () => void };

function openUrl(params: Record<string, string>): string {
  return `${ORIGIN}/coach/open?${new URLSearchParams(params).toString()}&${UTM}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Kibitzo's knight (public/favicon.svg), one colour: inline, so no site CSP can block it. */
const KNIGHT_PATHS = [
  "M25.192 23.015c-.1654 6.9672-11.758 5.2189-11.516 18.104l22.86.1184c-2.094-6.442 9.69-25.16-11.931-32.258v-.0001s-2.4381-2.601-5.9655-2.8237l.2227 3.5347-4.5583 4.5816c-2.6294 3.1455-8.7347 8.3784-7.7513 9.6111 3.1158 5.3041 6.3306 4.4316 6.3306 4.4316 4.2418-4.5433 5.8193-2.0894 12.309-5.2997z",
  "M25 36.457s-9.1309.048-11.691 1.6192c-1.7273 1.0602-2.1348 3.6514-1.8998 6.3237h27.182c.235-2.6723-.1725-5.2636-1.8999-6.3237-2.5597-1.5711-11.691-1.6192-11.691-1.6192z",
];

function knightIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "6 5 38 40");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "flex-shrink:0;vertical-align:-3px;margin-right:6px;transform:scaleX(-1)";
  for (const d of KNIGHT_PATHS) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "currentColor");
    svg.append(p);
  }
  return svg;
}

function linkEl(href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.title = "Open this finished game on Kibitzo's free analysis board";
  a.append(knightIcon(), LABEL);
  return a;
}

// ── chess.com ──────────────────────────────────────────────────────────

/** Game Review only exists for finished games; its href carries the id. */
const CC_REVIEW = /\/analysis\/game\/(?:live|daily)\/(\d{4,15})/;

function chessComPlayers(): string[] {
  const tags = [...document.querySelectorAll('[data-test-element="user-tagline-username"]')]
    .map((t) => (t.textContent ?? "").trim())
    .filter((u) => USERNAME.test(u));
  if (tags.length > 0) return [...new Set(tags)].slice(0, 2);
  const m = document.title.match(/^Chess: (\S+) vs (\S+) - \d+/);
  return m ? [m[1], m[2]].filter((u) => USERNAME.test(u)) : [];
}

function chessComButton(href: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute(MARK, "");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; display: block; margin-top: 8px; }
    a { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 100%; height: 44px;
        border-radius: 8px; background: linear-gradient(to right, #92400e, #b45309); color: #fff; text-decoration: none;
        font: 600 15px/1 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    a:hover { background: linear-gradient(to right, #b45309, #b85500); }`;
  root.append(style, linkEl(href));
  return host;
}

function placeChessCom() {
  for (const review of document.querySelectorAll<HTMLAnchorElement>('a[href*="tab=review"]')) {
    const id = review.getAttribute("href")?.match(CC_REVIEW)?.[1];
    const container = review.parentElement;
    if (!id || !container || container.nextElementSibling?.hasAttribute(MARK)) continue;
    const players = chessComPlayers();
    if (players.length === 0) continue;
    const flipped = document.querySelector("wc-chess-board.flipped") !== null;
    const params: Record<string, string> = { site: "chesscom", id, p: players.join(",") };
    if (flipped) params.pov = "black";
    container.after(chessComButton(openUrl(params)));
  }
}

// ── Lichess ────────────────────────────────────────────────────────────

const LICHESS_RESERVED = /^(training|analysis|practice|streamer|tournament|broadcast|study|editor)$/;

function lichessGameId(): string | null {
  const og = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "";
  const fromOg = og.match(/lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#]|$)/)?.[1];
  if (fromOg && !LICHESS_RESERVED.test(fromOg)) return fromOg;
  const fromPath = location.pathname.match(/^\/(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/|$)/)?.[1];
  return fromPath && !LICHESS_RESERVED.test(fromPath) ? fromPath : null;
}

function lichessButton(href: string, className: string): HTMLAnchorElement {
  const a = linkEl(href);
  a.className = className;
  a.setAttribute(MARK, "");
  return a;
}

function placeLichess() {
  const id = lichessGameId();
  if (!id) return;
  const params: Record<string, string> = { site: "lichess", id };
  if (document.querySelector(".cg-wrap.orientation-black")) params.pov = "black";
  const href = openUrl(params);
  // Right after your own game: the post-game row (Rematch, Analysis board).
  const followUp = document.querySelector(".rcontrols .follow-up");
  if (followUp && !followUp.querySelector(`[${MARK}]`)) followUp.append(lichessButton(href, "fbt"));
  // A finished game's page: the side panel's game info has a status line.
  const meta = document.querySelector("main.analyse .analyse__side .game__meta");
  if (meta?.querySelector("section.status") && !meta.nextElementSibling?.hasAttribute(MARK)) {
    const a = lichessButton(href, "button button-metal");
    a.style.cssText = "display:block;margin-top:.8em;text-align:center";
    meta.after(a);
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────

function start() {
  const g = globalThis as Guarded;
  if (g.__kibitzoSiteButton) return;
  g.__kibitzoSiteButton = true;
  const place = location.hostname.endsWith("lichess.org") ? placeLichess : placeChessCom;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      place();
    });
  };
  place();
  // Both sites are single-page apps: post-game UI appears without a page
  // load. One childList observer, batched to a frame; cheap queries only.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  g.__kibitzoSiteButtonStop = () => {
    observer.disconnect();
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
    g.__kibitzoSiteButton = false;
    g.__kibitzoSiteButtonStop = undefined;
  };
}

start();
