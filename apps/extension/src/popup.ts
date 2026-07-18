/**
 * Popup flow: opening the popup captures the visible tab (activeTab
 * permission, granted by the click itself), runs fenshot recognition
 * locally, and offers the read position for analysis. No content
 * scripts, no host permissions, nothing leaves the device.
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
import ortMjsUrl from "./ort/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "./ort/ort-wasm-simd-threaded.wasm?url";
import modelUrl from "../../../packages/fenshot/model/chess-tiles-v2.onnx?url";

const app = document.getElementById("app")!;

interface ResultState {
  scan: BoardScanResult;
  placement: string;
  flipped: boolean;
  turn: "w" | "b";
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
  footer.append("runs on your device · ", link("https://github.com/scoriiu/fenshot", "", "open source"));
  wrap.append(brand, ...content, footer);
  app.replaceChildren(wrap);
}

function renderMessage(title: string, hint: string, spinner = false) {
  const state = el("div", "state");
  if (spinner) state.append(el("div", "spinner"));
  state.append(el("p", undefined, title), el("p", "hint", hint));
  render(state);
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

  const actions = el("div", "actions");
  actions.append(
    link(analysisUrl, "btn primary", legalityWarning ? "Fix in Lichess editor" : "Analyze on Lichess"),
    link(coachessUrl, "btn", "Coachess"),
  );
  const copyBtn = el("button", "btn", "Copy FEN");
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(fen);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy FEN"), 1500);
  });
  actions.append(copyBtn);
  content.push(actions);

  render(...content);
}

async function captureTab(): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  const res = await fetch(dataUrl);
  return res.blob();
}

async function main() {
  renderMessage("Reading the board on this page…", "runs entirely on your device", true);
  try {
    const recognizer = createRecognizer({
      modelUrl,
      wasmPaths: { mjs: ortMjsUrl, wasm: ortWasmUrl },
    });
    const blob = await captureTab();
    const result = await recognizer.recognize(blob);
    if (!result) {
      renderMessage(
        "No chessboard found on this page.",
        "make sure the board is visible, then click the icon again",
      );
      return;
    }
    const oriented = resolveOrientation(result.placement);
    renderResult({
      scan: result,
      placement: oriented.placement,
      flipped: oriented.orientation === "black",
      turn: "w",
    });
  } catch (err) {
    console.error(err);
    renderMessage(
      "Could not read this page.",
      "some pages (like the Chrome Web Store) block screenshots, try another tab",
    );
  }
}

void main();
