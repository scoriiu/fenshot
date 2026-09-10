/**
 * Popup flow: opening the popup captures the visible tab (activeTab
 * permission, granted by the click itself), runs fenshot recognition
 * locally, and offers the read position for analysis. When the auto
 * read misses (busy page, multiple boards, blocked capture), the
 * popup never dead-ends: the user can drag a box around the board on
 * the captured page, upload an image, or paste a screenshot. All of
 * it stays on the device; no persistent content scripts, no host
 * permissions.
 *
 * In parallel with the screenshot, the popup reads the page's text
 * (one-shot chrome.scripting call, also covered by activeTab) and looks
 * for whole games written as move lists; see pgn.ts. Any game found is
 * offered next to the position, or on its own when no board was read.
 *
 * All rendering uses DOM construction, never innerHTML, so the AMO
 * linter and reviewers have nothing to question.
 */

import { Chess } from "chess.js";
import {
  createRecognizer,
  resolveOrientation,
  placementToFen,
  type BoardScanResult,
} from "@scoriiu/fenshot";
import { pieceElement } from "./pieces";
import { collectPageText, findGames, lichessGameUrl, coachessGameUrl, type FoundGame } from "./pgn";
import ortMjsUrl from "./ort/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "./ort/ort-wasm-simd-threaded.wasm?url";
import modelUrl from "../../../packages/fenshot/model/chess-tiles-v2.onnx?url";

const app = document.getElementById("app")!;
const isMac = navigator.platform.toUpperCase().includes("MAC");
const pasteKey = isMac ? "\u2318V" : "Ctrl+V";

type ScanOrigin = "page" | "area" | "image";

interface ResultState {
  scan: BoardScanResult;
  placement: string;
  flipped: boolean;
  turn: "w" | "b";
  origin: ScanOrigin;
}

let pageBitmap: ImageBitmap | null = null;
let pageGames: FoundGame[] = [];
let lastResult: ResultState | null = null;
/** Re-renders the screen currently shown, if it is one that lists games. */
let refreshScreen: (() => void) | null = null;
let recognizer: ReturnType<typeof createRecognizer> | null = null;

function getRecognizer() {
  if (!recognizer) {
    recognizer = createRecognizer({
      modelUrl,
      wasmPaths: { mjs: ortMjsUrl, wasm: ortWasmUrl },
    });
  }
  return recognizer;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function link(href: string, className: string, text: string): HTMLAnchorElement {
  const a = el("a", className, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  return a;
}

function render(...content: HTMLElement[]) {
  const wrap = el("div", "wrap");
  const brand = el("div", "brand");
  brand.append(el("span", "name", "fenshot"), el("span", "tag", "screenshot in, FEN out"));
  const footer = el("div", "footer");
  footer.append("runs on your device \u00b7 ", link("https://github.com/scoriiu/fenshot", "", "open source"));
  wrap.append(brand, ...content, footer);
  app.replaceChildren(wrap);
}

/**
 * Games found in the page text. One game: a single row. Several: a
 * list, longest first, each with the same actions. Returns null when
 * there is nothing to show so callers can append conditionally.
 */
function gamesEl(): HTMLElement | null {
  if (pageGames.length === 0) return null;
  const box = el("div", "games");
  const n = pageGames.length;
  box.append(el("div", "games-title", n === 1 ? "Game on this page" : `${n} games on this page`));
  for (const game of pageGames) {
    const row = el("div", "game");
    row.append(el("div", "game-label", game.label));
    const actions = el("div", "game-actions");
    actions.append(
      link(coachessGameUrl(game), "btn small primary", "Coachess"),
      link(lichessGameUrl(game), "btn small", "Lichess"),
    );
    const copy = el("button", "btn small", "Copy PGN");
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(game.pgn);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy PGN"), 1500);
    });
    actions.append(copy);
    row.append(actions);
    box.append(row);
  }
  return box;
}

function renderMessage(title: string, hint: string, spinner = false) {
  const state = el("div", "state");
  if (spinner) state.append(el("div", "spinner"));
  state.append(el("p", undefined, title), el("p", "hint", hint));
  render(state);
}

/**
 * The recovery hub. Whatever went wrong, the user always sees the
 * concrete ways forward, each one a single gesture. This screen IS
 * the onboarding: nobody needs a manual when the failure state lists
 * every capability.
 */
function renderHub(title: string, hint?: string) {
  refreshScreen = () => renderHub(title, hint);
  document.body.classList.remove("wide");
  const state = el("div", "state compact");
  state.append(el("p", undefined, title));
  if (hint) state.append(el("p", "hint", hint));

  const paths = el("div", "paths");
  if (pageBitmap) {
    const areaBtn = el("button", "btn primary", "Select the board on this page");
    areaBtn.addEventListener("click", () => renderCrop());
    paths.append(areaBtn);
  }
  const uploadBtn = el("button", "btn", "Upload an image");
  uploadBtn.addEventListener("click", () => fileInput.click());
  paths.append(uploadBtn);

  const pasteHint = el("p", "paste-hint", `or paste a screenshot with ${pasteKey} \u00b7 drag & drop works too`);
  const games = gamesEl();
  render(state, paths, pasteHint, ...(games ? [games] : []));
}

async function scanBlob(blob: Blob, origin: ScanOrigin) {
  renderMessage("Reading the position\u2026", "runs entirely on your device", true);
  try {
    const result = await getRecognizer().recognize(blob);
    // An automatic whole-page scan with an implausible read (no kings)
    // is a detector false positive on page UI, not a board. Explicit
    // origins (area, upload, paste) still render: the user asserted a
    // board is there, and the legality warning covers the rest.
    if (!result || (origin === "page" && !result.plausible)) {
      if (origin === "page") {
        renderHub("No chessboard found on this page.", "if you can see one, select it below");
      } else if (origin === "area") {
        renderHub("No chessboard in that selection.", "try a tighter box around just the board");
      } else {
        renderHub("No chessboard found in that image.", "try a clearer shot, or another way below");
      }
      return;
    }
    const oriented = resolveOrientation(result.placement);
    renderResult({
      scan: result,
      placement: oriented.placement,
      flipped: oriented.orientation === "black",
      turn: "w",
      origin,
    });
  } catch (err) {
    console.error(err);
    renderHub("Something went wrong reading that image.", "try another way below");
  }
}

function boardEl(placement: string, flipped: boolean): HTMLElement {
  const ranks = placement.split("/").map((row) =>
    row.replace(/\d/g, (d) => "1".repeat(parseInt(d, 10))),
  );
  const board = el("div", "board");
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rank = flipped ? 7 - r : r;
      const file = flipped ? 7 - f : f;
      const piece = ranks[rank][file];
      const light = (rank + file) % 2 === 0;
      const sq = el("div", `sq ${light ? "light" : "dark"}`);
      if (piece !== "1") {
        const svg = pieceElement(piece);
        if (svg) sq.append(svg);
      }
      board.append(sq);
    }
  }
  return board;
}

function renderResult(state: ResultState) {
  lastResult = state;
  refreshScreen = () => renderResult(state);
  document.body.classList.remove("wide");
  const fen = placementToFen(state.placement, state.turn);
  let legalityWarning: string | null = null;
  try {
    new Chess(fen);
  } catch {
    legalityWarning = "This position is not fully legal as read. Open it in the editor to fix squares.";
  }
  const reliabilityWarning = state.scan.reliable
    ? null
    : "This piece set is hard to read, some squares are probably wrong. Verify before trusting the analysis.";
  const warning = reliabilityWarning ?? legalityWarning;

  const lichessFen = fen.replaceAll(" ", "_");
  const analysisUrl = legalityWarning
    ? `https://lichess.org/editor/${lichessFen}`
    : `https://lichess.org/analysis/standard/${lichessFen}`;
  const coachessUrl = `https://coachess.app/coach/position?fen=${encodeURIComponent(fen)}${state.flipped ? "&pov=black" : ""}`;

  const content: HTMLElement[] = [boardEl(state.placement, state.flipped)];
  if (warning) content.push(el("div", "warning", warning));

  const turnRow = el("div", "turn");
  turnRow.append(el("span", "label", "to move"));
  const whiteBtn = el("button", state.turn === "w" ? "active" : "", "White");
  whiteBtn.addEventListener("click", () => renderResult({ ...state, turn: "w" }));
  const blackBtn = el("button", state.turn === "b" ? "active" : "", "Black");
  blackBtn.addEventListener("click", () => renderResult({ ...state, turn: "b" }));
  turnRow.append(whiteBtn, blackBtn);
  content.push(turnRow);

  // Coachess is the primary destination. An illegal read still goes to
  // the Lichess editor first, since that is where squares get fixed.
  const actions = el("div", "actions");
  if (legalityWarning) {
    actions.append(link(analysisUrl, "btn primary", "Fix in Lichess editor"), link(coachessUrl, "btn", "Coachess"));
  } else {
    actions.append(link(coachessUrl, "btn primary", "Analyze on Coachess"), link(analysisUrl, "btn", "Lichess"));
  }
  const copyBtn = el("button", "btn", "Copy FEN");
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(fen);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy FEN"), 1500);
  });
  actions.append(copyBtn);
  content.push(actions);

  if (pageBitmap && state.origin !== "image") {
    const rescan = el("div", "rescan");
    const fix = el("button", "linkish", "Wrong board or messy read? Select the area");
    fix.addEventListener("click", () => renderCrop());
    rescan.append(fix);
    content.push(rescan);
  }

  const games = gamesEl();
  if (games) content.push(games);

  render(...content);
}

/**
 * In-popup area selection over the already-captured page screenshot.
 * The screenshot is shown scaled; the drag rectangle is mapped back
 * to full-resolution coordinates before cropping, so the recognizer
 * always sees native pixels. No new permissions, no content scripts,
 * and no popup-blur problem because everything stays in the popup.
 */
function renderCrop() {
  const bitmap = pageBitmap;
  if (!bitmap) return;
  refreshScreen = null; // never yank the user out of a drag
  document.body.classList.add("wide");

  const maxW = 600;
  const maxH = 420;
  const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const stage = el("div", "crop-stage");
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  const canvas = el("canvas", "crop-canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const sel = el("div", "crop-sel");
  sel.style.display = "none";
  stage.append(canvas, sel);

  const bar = el("div", "crop-bar");
  bar.append(el("span", "hint", "Drag a box around the board"));
  const cancel = el("button", "btn small", "Cancel");
  cancel.addEventListener("click", () => {
    document.body.classList.remove("wide");
    if (lastResult) renderResult(lastResult);
    else renderHub("No chessboard found on this page.", "if you can see one, select it below");
  });
  bar.append(cancel);

  let sx = 0;
  let sy = 0;
  let dragging = false;
  const rect = { x: 0, y: 0, w: 0, h: 0 };

  const pos = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), w),
      y: Math.min(Math.max(e.clientY - r.top, 0), h),
    };
  };
  const update = (p: { x: number; y: number }) => {
    rect.x = Math.min(sx, p.x);
    rect.y = Math.min(sy, p.y);
    rect.w = Math.abs(p.x - sx);
    rect.h = Math.abs(p.y - sy);
    sel.style.display = "block";
    sel.style.left = `${rect.x}px`;
    sel.style.top = `${rect.y}px`;
    sel.style.width = `${rect.w}px`;
    sel.style.height = `${rect.h}px`;
  };

  stage.addEventListener("pointerdown", (e) => {
    dragging = true;
    const p = pos(e);
    sx = p.x;
    sy = p.y;
    stage.setPointerCapture(e.pointerId);
    update(p);
  });
  stage.addEventListener("pointermove", (e) => {
    if (dragging) update(pos(e));
  });
  stage.addEventListener("pointerup", () => {
    dragging = false;
    if (rect.w < 16 || rect.h < 16) return;
    document.body.classList.remove("wide");
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(rect.w / scale));
    crop.height = Math.max(1, Math.round(rect.h / scale));
    crop.getContext("2d")!.drawImage(
      bitmap,
      rect.x / scale,
      rect.y / scale,
      rect.w / scale,
      rect.h / scale,
      0,
      0,
      crop.width,
      crop.height,
    );
    crop.toBlob((b) => {
      if (b) void scanBlob(b, "area");
    }, "image/png");
  });

  render(stage, bar);
}

const fileInput = (() => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) void scanBlob(f, "image");
    input.value = "";
  });
  document.body.append(input);
  return input;
})();

window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        void scanBlob(f, "image");
      }
      return;
    }
  }
});

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("image/")) void scanBlob(f, "image");
});

async function captureTab(): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Read the page text and look for games. Best effort: browser-internal
 * pages, store pages and PDFs refuse injection, and that is fine; the
 * screenshot path does not depend on this in any way.
 */
async function findPageGames(): Promise<FoundGame[]> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return [];
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageText });
    const texts = frames.flatMap((f) => (f.result as string[] | undefined) ?? []);
    return findGames(texts);
  } catch (err) {
    console.warn("game scan skipped", err);
    return [];
  }
}

async function main() {
  renderMessage("Reading the board on this page\u2026", "runs entirely on your device", true);
  // Game scan runs alongside the screenshot. If it lands after the
  // board result is already on screen, that screen is refreshed so the
  // games appear; if it lands first, the next render picks them up.
  void findPageGames().then((games) => {
    pageGames = games;
    if (games.length) refreshScreen?.();
  });
  let blob: Blob;
  try {
    blob = await captureTab();
    pageBitmap = await createImageBitmap(blob);
  } catch (err) {
    console.error(err);
    renderHub("This page blocks screenshots.", `upload an image or paste one with ${pasteKey}`);
    return;
  }
  void scanBlob(blob, "page");
}

void main();
