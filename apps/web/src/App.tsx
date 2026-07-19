import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  createRecognizer,
  resolveOrientation,
  placementToFen,
  type BoardScanResult,
} from "@scoriiu/fenshot";
import { Board } from "./Board";
// src/ort/ is synced from onnxruntime-web by scripts/sync-ort.mjs
// (predev/prebuild); ?url makes Vite emit the files as hashed assets.
import ortMjsUrl from "./ort/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "./ort/ort-wasm-simd-threaded.wasm?url";
import modelUrl from "../../../packages/fenshot/model/chess-tiles-v2.onnx?url";

const BASE = import.meta.env.BASE_URL;

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "noboard" }
  | {
      kind: "result";
      scan: BoardScanResult;
      placement: string;
      flipped: boolean;
      turn: "w" | "b";
      imageUrl: string;
    };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const recognizer = useMemo(
    () =>
      createRecognizer({
        modelUrl,
        wasmPaths: { mjs: ortMjsUrl, wasm: ortWasmUrl },
      }),
    [],
  );

  const scan = useCallback(
    async (blob: Blob) => {
      setPhase({ kind: "scanning" });
      try {
        const result = await recognizer.recognize(blob);
        if (!result) {
          setPhase({ kind: "noboard" });
          return;
        }
        const oriented = resolveOrientation(result.placement);
        setPhase({
          kind: "result",
          scan: result,
          placement: oriented.placement,
          flipped: oriented.orientation === "black",
          turn: "w",
          imageUrl: URL.createObjectURL(blob),
        });
      } catch (err) {
        console.error(err);
        setPhase({ kind: "noboard" });
      }
    },
    [recognizer],
  );

  const reset = useCallback(() => {
    if (phase.kind === "result") URL.revokeObjectURL(phase.imageUrl);
    setPhase({ kind: "idle" });
  }, [phase]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void scan(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [scan]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (file) void scan(file);
    },
    [scan],
  );

  const result = phase.kind === "result" ? phase : null;
  const fen = result ? placementToFen(result.placement, result.turn) : null;
  const legality = useMemo(() => {
    if (!fen) return null;
    try {
      new Chess(fen);
      return null;
    } catch {
      return "This position is not fully legal, fix it in the Lichess editor.";
    }
  }, [fen]);

  const copyFen = async () => {
    if (!fen) return;
    await navigator.clipboard.writeText(fen);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lichessFen = fen?.replaceAll(" ", "_");

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="brand-accent">fen</span>shot
        </div>
        <div className="tagline">Screenshot in. FEN out. Nothing leaves your browser.</div>
        <a className="gh-link" href="https://github.com/scoriiu/fenshot" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      {!result && (
        <main
          className={`dropzone ${dragging ? "dropzone-active" : ""} ${phase.kind === "scanning" ? "dropzone-busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onPointerEnter={() => recognizer.warmUp()}
          onClick={() => fileInputRef.current?.click()}
        >
          {phase.kind === "scanning" ? (
            <div className="scan-status">
              <div className="spinner" />
              Reading the board…
            </div>
          ) : (
            <>
              <div className="drop-title">Paste a chessboard screenshot</div>
              <div className="drop-sub">
                <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere, drop an image here, or click to choose a file
              </div>
              <div className="drop-hint">chess.com · lichess · book diagrams · reddit posts</div>
              {phase.kind === "noboard" && (
                <div className="noboard">No chessboard found in that image. Try a tighter crop.</div>
              )}
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scan(f);
              e.target.value = "";
            }}
          />
        </main>
      )}

      {result && fen && (
        <main className="result">
          <div className="media-row">
            <figure className="shot-card">
              <div className="shot-frame">
                <img src={result.imageUrl} alt="Your screenshot" />
              </div>
              <figcaption>Your screenshot</figcaption>
            </figure>
            <div className="transform-arrow" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </div>
            <figure className="shot-card">
              <div className="shot-frame">
                <div className="result-board">
                  <Board placement={result.placement} flipped={result.flipped} />
                </div>
              </div>
              <figcaption>What fenshot read · {Math.round(result.scan.meanConfidence * 100)}%</figcaption>
            </figure>
          </div>
          <div className="result-panel">
            {!result.scan.reliable && (
              <div className="warning">
                Low-confidence read (worst tile {Math.round(result.scan.minConfidence * 100)}%). Double-check the
                pieces before trusting this.
              </div>
            )}
            {legality && <div className="warning">{legality}</div>}

            <label className="fen-label">FEN</label>
            <div className="fen-row">
              <code className="fen">{fen}</code>
              <button className="btn btn-quiet" onClick={copyFen}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="panel-bottom">
              <div className="controls">
                <div className="control-group">
                  <span className="control-label">Side to move</span>
                  <div className="toggle">
                    <button
                      className={result.turn === "w" ? "on" : ""}
                      onClick={() => setPhase({ ...result, turn: "w" })}
                    >
                      White
                    </button>
                    <button
                      className={result.turn === "b" ? "on" : ""}
                      onClick={() => setPhase({ ...result, turn: "b" })}
                    >
                      Black
                    </button>
                  </div>
                </div>
                <button
                  className="btn btn-quiet"
                  onClick={() => setPhase({ ...result, flipped: !result.flipped })}
                >
                  Flip board
                </button>
              </div>

              <div className="actions">
                <button className="btn btn-rescan" onClick={reset}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v4h4" />
                  </svg>
                  Scan another
                </button>
                <a className="btn" href={`https://lichess.org/analysis/standard/${lichessFen}`} target="_blank" rel="noreferrer">
                  Analyze on Lichess
                </a>
                <a className="btn" href={`https://lichess.org/editor/${lichessFen}`} target="_blank" rel="noreferrer">
                  Lichess editor
                </a>
                <a
                  className="btn btn-primary"
                  href={`https://coachess.app/coach/position?fen=${encodeURIComponent(fen ?? "")}${result?.flipped ? "&pov=black" : ""}&ref=fenshot-web`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Analyze on Coachess
                </a>
              </div>
            </div>
          </div>
        </main>
      )}

      <footer className="footer">
        MIT open source · built from the position import of{" "}
        <a href="https://coachess.app?ref=fenshot-web" target="_blank" rel="noreferrer">
          coachess.app
        </a>
      </footer>
    </div>
  );
}
