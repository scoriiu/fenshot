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

const STORES = {
  Chrome:
    "https://chromewebstore.google.com/detail/fenshot-chess-board-to-fe/fpkdijjlnafehkdkjmkppcekocjdomkc",
  Firefox: "https://addons.mozilla.org/en-US/firefox/addon/fenshot/",
  Edge: "https://microsoftedge.microsoft.com/addons/detail/fenshot-chess-board-to-f/cjcpedpebpfcedbcfejppadobfohbaif",
} as const;

type StoreName = keyof typeof STORES;

/** Edge ships "Edg/" in the UA; Firefox ships "Firefox". Everything else
 *  (Chrome, Brave, Opera, Vivaldi, Arc) installs from the Chrome store. */
function detectBrowser(): StoreName {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Firefox")) return "Firefox";
  return "Chrome";
}

// Monochrome brand marks (simple-icons, CC0), rendered in currentColor.
const ICON_PATHS: Record<StoreName, string> = {
  Chrome:
    "M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z",
  Firefox:
    "M8.824 7.287c.008 0 .004 0 0 0zm-2.8-1.4c.006 0 .003 0 0 0zm16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477-.091-.147-.184-.292-.273-.446a3.545 3.545 0 01-.13-.24 2.118 2.118 0 01-.172-.46.03.03 0 00-.027-.03.038.038 0 00-.021 0l-.006.001a.037.037 0 00-.01.005L15.624 0c-2.585 1.515-3.657 4.168-3.932 5.856a6.197 6.197 0 00-2.305.587.297.297 0 00-.147.37c.057.162.24.24.396.17a5.622 5.622 0 012.008-.523l.067-.005a5.847 5.847 0 011.957.222l.095.03a5.816 5.816 0 01.616.228c.08.036.16.073.238.112l.107.055a5.835 5.835 0 01.368.211 5.953 5.953 0 012.034 2.104c-.62-.437-1.733-.868-2.803-.681 4.183 2.09 3.06 9.292-2.737 9.02a5.164 5.164 0 01-1.513-.292 4.42 4.42 0 01-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806 0 0 .537-2 3.845-2 .357 0 1.38-.998 1.398-1.287-.005-.095-2.029-.9-2.817-1.677-.422-.416-.622-.616-.8-.767a3.47 3.47 0 00-.301-.227 5.388 5.388 0 01-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913-.006-.025-.343.176-.389.206-.406.29-.787.616-1.136.974-.397.403-.76.839-1.085 1.303a9.816 9.816 0 00-1.562 3.52c-.003.013-.11.487-.19 1.073-.013.09-.026.181-.037.272a7.8 7.8 0 00-.069.667l-.002.034-.023.387-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661.02-.149.035-.298.052-.448.232-1.994-.025-4.09-.753-5.844z",
  Edge: "M21.86 17.86q.14 0 .25.12.1.13.1.25t-.11.33l-.32.46-.43.53-.44.5q-.21.25-.38.42l-.22.23q-.58.53-1.34 1.04-.76.51-1.6.91-.86.4-1.74.64t-1.67.24q-.9 0-1.69-.28-.8-.28-1.48-.78-.68-.5-1.22-1.17-.53-.66-.92-1.44-.38-.77-.58-1.6-.2-.83-.2-1.67 0-1 .32-1.96.33-.97.87-1.8.14.95.55 1.77.41.82 1.02 1.5.6.68 1.38 1.21.78.54 1.64.9.86.36 1.77.56.92.2 1.8.2 1.12 0 2.18-.24 1.06-.23 2.06-.72l.2-.1.2-.05zm-15.5-1.27q0 1.1.27 2.15.27 1.06.78 2.03.51.96 1.24 1.77.74.82 1.66 1.4-1.47-.2-2.8-.74-1.33-.55-2.48-1.37-1.15-.83-2.08-1.9-.92-1.07-1.58-2.33T.36 14.94Q0 13.54 0 12.06q0-.81.32-1.49.31-.68.83-1.23.53-.55 1.2-.96.66-.4 1.35-.66.74-.27 1.5-.39.78-.12 1.55-.12.7 0 1.42.1.72.12 1.4.35.68.23 1.32.57.63.35 1.16.83-.35 0-.7.07-.33.07-.65.23v-.02q-.63.28-1.2.74-.57.46-1.05 1.04-.48.58-.87 1.26-.38.67-.65 1.39-.27.71-.42 1.44-.15.72-.15 1.38zM11.96.06q1.7 0 3.33.39 1.63.38 3.07 1.15 1.43.77 2.62 1.93 1.18 1.16 1.98 2.7.49.94.76 1.96.28 1 .28 2.08 0 .89-.23 1.7-.24.8-.69 1.48-.45.68-1.1 1.22-.64.53-1.45.88-.54.24-1.11.36-.58.13-1.16.13-.42 0-.97-.03-.54-.03-1.1-.12-.55-.1-1.05-.28-.5-.19-.84-.5-.12-.09-.23-.24-.1-.16-.1-.33 0-.15.16-.35.16-.2.35-.5.2-.28.36-.68.16-.4.16-.95 0-1.06-.4-1.96-.4-.91-1.06-1.64-.66-.74-1.52-1.28-.86-.55-1.79-.89-.84-.3-1.72-.44-.87-.14-1.76-.14-1.55 0-3.06.45T.94 7.55q.71-1.74 1.81-3.13 1.1-1.38 2.52-2.35Q6.68 1.1 8.37.58q1.7-.52 3.58-.52Z",
};

function BrowserIcon({ name }: { name: StoreName }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

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
  const browser = useMemo(detectBrowser, []);
  const demoVideoRef = useRef<HTMLVideoElement>(null);
  const [demoEnded, setDemoEnded] = useState(false);
  const [demoCycle, setDemoCycle] = useState(0);

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
        <h1 className="brand">
          <span className="brand-accent">fen</span>shot
        </h1>
        <p className="tagline">Chess screenshot in. FEN out. Nothing leaves your browser.</p>
        <a className="gh-link" href="https://github.com/scoriiu/fenshot" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      {!result && (
        <main className="idle-grid">
        <div
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
        </div>
        <aside className="ext-panel" aria-label="The fenshot browser extension">
          <div className="demo-media">
            <video
              ref={demoVideoRef}
              src="/fenshot-demo.mp4"
              poster="/fenshot-demo-poster.jpg"
              autoPlay
              muted
              playsInline
              onEnded={() => setDemoEnded(true)}
            />
            {!demoEnded && <div key={demoCycle} className="demo-scanline" aria-hidden />}
            {demoEnded && (
              <button
                className="demo-replay"
                onClick={() => {
                  setDemoCycle((c) => c + 1);
                  setDemoEnded(false);
                  void demoVideoRef.current?.play();
                }}
              >
                ▶ Replay demo
              </button>
            )}
          </div>
          <div className="ext-panel-body">
            <p className="ext-panel-note">
              Skip the screenshot next time. The extension reads the board on
              any page, one click.
            </p>
            <div className="ext-panel-buttons">
              {(Object.keys(STORES) as StoreName[]).map((name) => (
                <a
                  key={name}
                  className={`install-btn ${name === browser ? "primary" : ""}`}
                  href={STORES[name]}
                  target="_blank"
                  rel="noreferrer"
                  data-umami-event="store-click"
                  data-umami-event-store={name.toLowerCase()}
                >
                  <BrowserIcon name={name} />
                  {name === browser ? `Add to ${name}` : name}
                </a>
              ))}
            </div>
            <div className="ext-panel-meta">
              <span>Free</span>
              <span>Open source</span>
              <span>No account</span>
              <span>Nothing uploaded</span>
            </div>
          </div>
        </aside>
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
