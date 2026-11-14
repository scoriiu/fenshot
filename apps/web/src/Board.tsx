import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Board as LightsquareBoard, PieceCode } from "@kibitzo/lightsquare";
import { editor, type Editor, type EditorTool } from "@kibitzo/lightsquare/editor";
import { Lightsquare } from "@kibitzo/lightsquare/react";
import "@kibitzo/lightsquare/lightsquare.css";
import "@kibitzo/lightsquare/pieces/kibitzo.css";

export type Tool = EditorTool;
export const WHITE: PieceCode[] = ["wk", "wq", "wr", "wb", "wn", "wp"];
export const BLACK: PieceCode[] = ["bk", "bq", "br", "bb", "bn", "bp"];

export interface BoardHandle {
  /** Carry a new piece from the palette onto the board, following this pointer. */
  carry(piece: PieceCode, event: PointerEvent): void;
}

/**
 * The mouse pointer of a piece in hand: the piece itself. A cursor must say
 * how large it is and a piece's picture does not, so the picture is set
 * into a small one that does. A browser that will not draw that (pictures
 * inside pictures are restricted) would show no pointer at all, so each is
 * drawn once to a canvas first and used only if something came out.
 */
function pieceCursors(into: Partial<Record<Tool, string>>): void {
  const style = getComputedStyle(document.documentElement);
  for (const code of [...WHITE, ...BLACK]) {
    const picture = /^url\((["']?)(data:.*)\1\)$/.exec(style.getPropertyValue(`--ls-${code}`).trim())?.[2];
    if (!picture) continue;
    const href = picture.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const sized = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="${href}" width="40" height="40"/></svg>`)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 40;
      const pen = canvas.getContext("2d");
      if (!pen) return;
      pen.drawImage(img, 0, 0, 40, 40);
      const drawn = pen.getImageData(0, 0, 40, 40).data.some((value, i) => i % 4 === 3 && value > 0);
      if (drawn) into[code] = `url("${sized}") 20 20, copy`;
    };
    img.src = sized;
  }
}

/**
 * The board of the result screen, and an editor at once: with the hand the
 * pieces move freely, the eraser and a piece in hand work on the squares
 * they touch (Lightsquare's editor module). `placement` is the position as
 * a FEN's first field; `onEdit` tells every change the user makes to it.
 */
export const Board = forwardRef<BoardHandle, { placement: string; flipped: boolean; tool: Tool; onEdit(placement: string): void }>(function Board(
  { placement, flipped, tool, onEdit },
  ref,
) {
  const board = useRef<LightsquareBoard>(null);
  const edit = useRef<Editor | null>(null);
  const latest = useRef({ onEdit, tool });
  latest.current = { onEdit, tool };

  useEffect(() => {
    const b = board.current;
    if (!b) return;
    const cursors: Partial<Record<Tool, string>> = {};
    pieceCursors(cursors);
    const made = b.use(
      editor({
        tool: latest.current.tool,
        cursors,
        onChange(next, how) {
          b.set({ position: next }, how);
          latest.current.onEdit(next);
        },
      }),
    );
    edit.current = made;
    return () => {
      made.destroy?.();
      edit.current = null;
    };
  }, []);

  useEffect(() => {
    edit.current?.pick(tool);
  }, [tool]);

  useImperativeHandle(ref, () => ({ carry: (piece, event) => edit.current?.drag(piece, event) }), []);

  return <Lightsquare ref={board} className="board-host" position={placement} orientation={flipped ? "black" : "white"} movable="both" />;
});

const HAND = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M14 11V6a1.5 1.5 0 0 1 3 0v6" />
    <path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-4.9-2.5L4.4 14a1.6 1.6 0 0 1 2.5-2L8 13" />
  </svg>
);

/** The waste bin of the eraser: the same drawing as its mouse pointer. */
const ERASER = (
  <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6.2 9h15.6" />
    <path d="M11 9V7.4a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 17 7.4V9" />
    <path d="M8.1 9l.9 12.2a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L19.9 9" />
    <path d="M12.2 12.6v6.6M15.8 12.6v6.6" />
  </svg>
);

/**
 * One row of the palette, as on Lichess: the hand, the six pieces of one
 * colour, the eraser. A click takes a tool in hand; a piece can also be
 * dragged straight onto the board.
 */
export function SpareRow({
  pieces,
  tool,
  labels,
  onPick,
  onCarry,
}: {
  pieces: PieceCode[];
  tool: Tool;
  labels: { move: string; erase: string; side: string };
  onPick(tool: Tool): void;
  onCarry(piece: PieceCode, event: PointerEvent): void;
}) {
  /** A press on a piece that then travels is a carry; one that stays put is a click. */
  const press = (piece: PieceCode, down: React.PointerEvent) => {
    if (down.button > 0) return;
    const { pointerId, clientX, clientY } = down;
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || Math.hypot(e.clientX - clientX, e.clientY - clientY) < 5) return;
      done();
      onCarry(piece, e);
    };
    const done = () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  return (
    <div className="spares" role="toolbar">
      <button type="button" className={`spare spare-tool ${tool === "move" ? "on" : ""}`} title={labels.move} aria-label={labels.move} aria-pressed={tool === "move"} data-tool="move" onClick={() => onPick("move")}>
        {HAND}
      </button>
      {pieces.map((piece) => (
        <button
          key={piece}
          type="button"
          className={`spare ${tool === piece ? "on" : ""}`}
          aria-label={`${labels.side} ${piece[1].toUpperCase()}`}
          aria-pressed={tool === piece}
          data-tool={piece}
          onPointerDown={(e) => press(piece, e)}
          onClick={() => onPick(tool === piece ? "move" : piece)}
        >
          <span className={`spare-piece ls-${piece}`} />
        </button>
      ))}
      <button type="button" className={`spare spare-tool spare-erase ${tool === "erase" ? "on" : ""}`} title={labels.erase} aria-label={labels.erase} aria-pressed={tool === "erase"} data-tool="erase" onClick={() => onPick(tool === "erase" ? "move" : "erase")}>
        {ERASER}
      </button>
    </div>
  );
}
