/**
 * Popup flow: opening the popup captures the visible tab (activeTab
 * permission, granted by the click itself), runs fenshot recognition
 * locally, and offers the read position for analysis. No content
 * scripts, no host permissions, nothing leaves the device.
 */

import { Chess } from "chess.js";
import {
  createRecognizer,
  resolveOrientation,
  placementToFen,
  type BoardScanResult,
} from "@scoriiu/fenshot";
import ortMjsUrl from "./ort/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "./ort/ort-wasm-simd-threaded.wasm?url";
import modelUrl from "../../../packages/fenshot/model/chess-tiles-v2.onnx?url";

import { pieceSvg } from "./pieces";

const app = document.getElementById("app")!;

interface ResultState {
  scan: BoardScanResult;
  placement: string;
  flipped: boolean;
  turn: "w" | "b";
}

function shell(inner: string): string {
  return `
    <div class="wrap">
      <div class="brand"><span class="name">fenshot</span><span class="tag">screenshot in, FEN out</span></div>
      ${inner}
      <div class="footer">runs on your device · <a href="https://github.com/scoriiu/fenshot" target="_blank" rel="noreferrer">open source</a></div>
    </div>`;
}

function renderMessage(title: string, hint: string, spinner = false) {
  app.innerHTML = shell(`
    <div class="state">
      ${spinner ? '<div class="spinner"></div>' : ""}
      <p>${title}</p>
      <p class="hint">${hint}</p>
    </div>`);
}

function boardHtml(placement: string, flipped: boolean): string {
  const ranks = placement.split("/").map((row) =>
    row.replace(/\d/g, (d) => "1".repeat(parseInt(d, 10))),
  );
  const squares: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rank = flipped ? 7 - r : r;
      const file = flipped ? 7 - f : f;
      const piece = ranks[rank][file];
      const light = (rank + file) % 2 === 0;
      const svg = piece === "1" ? "" : pieceSvg(piece);
      squares.push(`<div class="sq ${light ? "light" : "dark"}">${svg}</div>`);
    }
  }
  return `<div class="board">${squares.join("")}</div>`;
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

  app.innerHTML = shell(`
    ${boardHtml(state.placement, state.flipped)}
    ${warning ? `<div class="warning">${warning}</div>` : ""}
    <div class="turn">
      <span class="label">to move</span>
      <button id="turn-w" class="${state.turn === "w" ? "active" : ""}">White</button>
      <button id="turn-b" class="${state.turn === "b" ? "active" : ""}">Black</button>
    </div>
    <div class="actions">
      <a id="open-lichess" class="btn primary" href="${analysisUrl}" target="_blank" rel="noreferrer">${legalityWarning ? "Fix in Lichess editor" : "Analyze on Lichess"}</a>
      <a id="open-coachess" class="btn" href="${coachessUrl}" target="_blank" rel="noreferrer">Coachess</a>
      <button id="copy-fen" class="btn">Copy FEN</button>
    </div>`);

  document.getElementById("turn-w")!.addEventListener("click", () => renderResult({ ...state, turn: "w" }));
  document.getElementById("turn-b")!.addEventListener("click", () => renderResult({ ...state, turn: "b" }));
  document.getElementById("copy-fen")!.addEventListener("click", async () => {
    await navigator.clipboard.writeText(fen);
    const btn = document.getElementById("copy-fen")!;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy FEN"), 1500);
  });
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
