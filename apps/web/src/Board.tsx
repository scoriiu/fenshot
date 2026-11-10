import { useEffect, useRef } from "react";
import { Chessboard, COLOR } from "cm-chessboard/src/Chessboard.js";
import "cm-chessboard/assets/chessboard.css";

/** Resolved from this script's own address (/assets/…), not from the page:
 *  the same bundle runs on / and on every /<language>/ page, and a path
 *  relative to the page 404s there (the board then shows no pieces, and
 *  the host's "not found" page gets injected in place of the piece set). */
const ASSETS = new URL("../cm-chessboard/", import.meta.url).href;

export function Board({ placement, flipped }: { placement: string; flipped: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<InstanceType<typeof Chessboard> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const board = new Chessboard(hostRef.current, {
      assetsUrl: ASSETS,
      position: placement,
      orientation: flipped ? COLOR.black : COLOR.white,
      style: { pieces: { file: "pieces/staunty.svg" }, animationDuration: 200 },
    });
    boardRef.current = board;
    return () => {
      board.destroy();
      boardRef.current = null;
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    void board.setPosition(placement, false);
    void board.setOrientation(flipped ? COLOR.black : COLOR.white, false);
  }, [placement, flipped]);

  return <div ref={hostRef} className="board-host" />;
}
