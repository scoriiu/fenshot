/**
 * Whole-game import. Pages that show a game (chessgames.com, lichess,
 * chess.com, chesstempo, blogs) already carry the move list as text in
 * the DOM, so there is nothing to recognise, only something to find.
 *
 * Two halves:
 *
 * 1. `collectPageText` runs inside the tab (chrome.scripting, granted
 *    by the activeTab click). It is a pure function that returns
 *    strings; it must not close over anything from this module because
 *    it is serialised and executed in the page's isolated world.
 *
 * 2. `findGames` runs in the popup: it scans the strings for numbered
 *    move sequences and replays each candidate through chess.js. Only
 *    sequences that replay legally become results, which is what keeps
 *    false positives at zero without any model: random text almost
 *    never forms a legal game.
 */

import { Chess } from "chess.js";

export interface FoundGame {
  /** SAN moves in order, as replayed. */
  moves: string[];
  /** Seven-tag-roster-ish headers found right before the moves. */
  headers: Record<string, string>;
  /** Full PGN text: headers + movetext, suitable for import anywhere. */
  pgn: string;
  /** Short human label: "Kasparov – Karpov, 1985 (41 moves)". */
  label: string;
}

/** Injected into the page. Self-contained on purpose; see file header. */
export function collectPageText(): string[] {
  const out: string[] = [];
  const cap = 400_000;
  const push = (s: string | null | undefined) => {
    if (s && s.trim().length > 12) out.push(s.slice(0, cap));
  };
  // Explicit PGN carriers first: they are the cleanest source.
  for (const ta of document.querySelectorAll("textarea")) push(ta.value);
  for (const n of document.querySelectorAll("[data-pgn]")) push(n.getAttribute("data-pgn"));
  for (const n of document.querySelectorAll("pre, code")) push(n.textContent);
  // Then the rendered page text, which covers move tables and lists.
  push(document.body?.innerText);
  return out;
}

const SAN =
  /^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?[!?]{0,2}$/;
const MOVE_NO = /^(\d{1,3})\.(?:\.\.)?$/;
const MOVE_NO_INLINE = /^(\d{1,3})\.(\.\.)?(\S+)$/;
const RESULT = /^(?:1-0|0-1|1\/2-1\/2|½-½|\*)$/;
const TAG = /\[(\w+)\s+"([^"]*)"\]/g;

const MIN_PLIES = 6;

/** Drop comments, variations and NAGs so the tokenizer sees only moves. */
function stripAnnotations(s: string): string {
  let t = s.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ").replace(/\$\d+/g, " ");
  // Variations may nest; peel from the inside out.
  for (let i = 0; i < 6 && /\([^()]*\)/.test(t); i++) t = t.replace(/\([^()]*\)/g, " ");
  return t;
}

/**
 * From a "1." anchor, read forward token by token, collecting SAN moves
 * until something that is not a move, move number or result shows up.
 */
function readSequence(tokens: string[], start: number): string[] {
  const moves: string[] = [];
  for (let i = start; i < tokens.length; i++) {
    const tok = tokens[i];
    if (MOVE_NO.test(tok)) continue;
    if (RESULT.test(tok)) break;
    const inline = MOVE_NO_INLINE.exec(tok);
    const san = inline ? inline[3] : tok;
    if (!SAN.test(san)) break;
    moves.push(san.replace(/[!?]+$/, "").replace(/^0-0-0$/, "O-O-O").replace(/^0-0$/, "O-O"));
  }
  return moves;
}

/** Replay; on the first illegal move, keep the legal prefix. */
function replay(moves: string[]): string[] {
  const chess = new Chess();
  const ok: string[] = [];
  for (const m of moves) {
    try {
      chess.move(m);
      ok.push(m);
    } catch {
      break;
    }
  }
  return ok;
}

function headersBefore(text: string, at: number): Record<string, string> {
  const window = text.slice(Math.max(0, at - 1500), at);
  const headers: Record<string, string> = {};
  for (const m of window.matchAll(TAG)) headers[m[1]] = m[2];
  return headers;
}

function movetext(moves: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(moves[i]);
  }
  return parts.join(" ");
}

function labelFor(headers: Record<string, string>, moves: string[]): string {
  const n = Math.ceil(moves.length / 2);
  const w = headers.White?.trim();
  const b = headers.Black?.trim();
  const year = headers.Date?.match(/\d{4}/)?.[0];
  const who = w && b ? `${w} \u2013 ${b}` : headers.Event?.trim() || "Game";
  return `${who}${year ? `, ${year}` : ""} (${n} move${n === 1 ? "" : "s"})`;
}

export function findGames(texts: string[]): FoundGame[] {
  const games: FoundGame[] = [];
  const seen = new Set<string>();

  for (const raw of texts) {
    const text = stripAnnotations(raw);
    // Every "1." (or "1.e4") is a possible game start. Tokenise once,
    // remember token offsets so headers can be looked up by position.
    const tokens: string[] = [];
    const offsets: number[] = [];
    for (const m of text.matchAll(/\S+/g)) {
      tokens.push(m[0]);
      offsets.push(m.index!);
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t !== "1." && !/^1\.[^.]/.test(t)) continue;
      const moves = replay(readSequence(tokens, i));
      if (moves.length < MIN_PLIES) continue;
      const key = moves.join(" ");
      if (seen.has(key)) continue;
      // The same game often appears twice on a page (move table plus a
      // PGN textarea), sometimes truncated. Keep only the longest
      // rendering: skip a prefix of a known game, and evict known games
      // that are prefixes of this one.
      if ([...seen].some((k) => k.startsWith(key + " "))) continue;
      for (let g = games.length - 1; g >= 0; g--) {
        const k = games[g].moves.join(" ");
        if (key.startsWith(k + " ")) {
          games.splice(g, 1);
          seen.delete(k);
        }
      }
      seen.add(key);
      const headers = headersBefore(text, offsets[i]);
      const tagLines = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`);
      const pgn = (tagLines.length ? tagLines.join("\n") + "\n\n" : "") + movetext(moves);
      games.push({ moves, headers, pgn, label: labelFor(headers, moves) });
    }
  }
  // Longest first: on a page with one main game plus snippets, the
  // main game is what the user came for.
  return games.sort((a, b) => b.moves.length - a.moves.length);
}

export function lichessGameUrl(game: FoundGame): string {
  return `https://lichess.org/analysis/pgn/${game.moves.map(encodeURIComponent).join("_")}`;
}

export function coachessGameUrl(game: FoundGame): string {
  return `https://coachess.app/coach/game?pgn=${encodeURIComponent(game.pgn)}`;
}
