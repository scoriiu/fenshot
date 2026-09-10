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
  /^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?(?:[2-7]|[18](?:=?[QRBN])?))[+#]?[!?]{0,2}$/;
// "1." "1..." and bare "1" (lichess renders numbers without a dot).
const MOVE_NO = /^(\d{1,3})(?:\.(?:\.\.)?)?$/;
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
function readSequence(tokens: string[], start: number): { moves: string[]; result?: string } {
  const moves: string[] = [];
  for (let i = start; i < tokens.length; i++) {
    const tok = tokens[i];
    if (MOVE_NO.test(tok)) continue;
    if (RESULT.test(tok)) return { moves, result: tok === "\u00bd-\u00bd" ? "1/2-1/2" : tok };
    const inline = MOVE_NO_INLINE.exec(tok);
    const san = inline ? inline[3] : tok;
    if (!SAN.test(san)) break;
    moves.push(san.replace(/[!?]+$/, "").replace(/^0-0-0$/, "O-O-O").replace(/^0-0$/, "O-O"));
  }
  return { moves };
}

const SAN_SRC = SAN.source.slice(1, -1); // unanchored, for splitting glued pairs
const RESULT_SRC = "1-0|0-1|1/2-1/2|\u00bd-\u00bd|\\*";
// Two moves first: "Kf1g5" also parses as one (over-disambiguated)
// SAN move, so the single-move form is only a fallback for line ends.
const PAIR = new RegExp(`^(${SAN_SRC})(${SAN_SRC})(${RESULT_SRC})?$`);
const SINGLE = new RegExp(`^(${SAN_SRC})(${RESULT_SRC})?$`);

/**
 * Sites that render each move in its own element (chessgames.com) give
 * an innerText with no whitespace at all: "1.e4e52.f4exf43.Bc4Qh4+4.".
 * The only reliable separator is the dot after a move number, since a
 * SAN move never contains one. Walk the numbers in order, cut each
 * segment at the next "<n+1>." and split it into white/black moves.
 * Returns null when the token is not such a run.
 */
function explodeGlued(tok: string): string[] | null {
  const head = /^(\d{1,3})(\.(?:\.\.)?)?(?=\S)/.exec(tok);
  if (!head || MOVE_NO.test(tok)) return null;
  // Lichess-style runs have no dots at all ("1e4e52Nf3"); when the
  // token has dots, the next number must carry one too, which removes
  // nearly all ambiguity between "e5" + "2." and "e52".
  const dotted = tok.includes(".");
  const out: string[] = [];
  let n = parseInt(head[1], 10);
  let pos = 0;
  for (;;) {
    const num = `${n}`;
    if (!tok.startsWith(num, pos)) break;
    pos += num.length;
    if (tok.startsWith("...", pos)) pos += 3;
    else if (tok.startsWith(".", pos)) pos += 1;
    const next = `${n + 1}${dotted ? "." : ""}`;
    // Every occurrence of the next move number is a candidate cut; the
    // first one that leaves a valid white+black pair before it wins.
    let cut = -1;
    let pair: RegExpExecArray | null = null;
    for (let p = tok.indexOf(next, pos + 1); p >= 0; p = tok.indexOf(next, p + 1)) {
      pair = PAIR.exec(tok.slice(pos, p));
      if (pair) {
        cut = p;
        break;
      }
    }
    if (cut < 0) {
      // Last segment: one or two moves, optional result, then the end.
      const rest = tok.slice(pos);
      const m = PAIR.exec(rest) ?? SINGLE.exec(rest);
      if (!m) return out.length ? out : null;
      out.push(`${n}.`, ...m.slice(1).filter((s): s is string => !!s));
      break;
    }
    out.push(`${n}.`, pair![1], pair![2]);
    if (pair![3]) out.push(pair![3]);
    pos = cut;
    n += 1;
  }
  return out.length ? out : null;
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
      const glued = explodeGlued(m[0]);
      if (glued) {
        for (const g of glued) {
          tokens.push(g);
          offsets.push(m.index!);
        }
      } else {
        tokens.push(m[0]);
        offsets.push(m.index!);
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t !== "1." && t !== "1" && !/^1\.[^.]/.test(t)) continue;
      const seq = readSequence(tokens, i);
      const moves = replay(seq.moves);
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
      // A result token closing the move list (chessgames, most tables)
      // counts as a header when the page has no PGN tag for it, and
      // only when the replay consumed the whole line: a truncated line
      // has no known outcome.
      if (!headers.Result && seq.result && moves.length === seq.moves.length) headers.Result = seq.result;
      const tagLines = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`);
      const pgn =
        (tagLines.length ? tagLines.join("\n") + "\n\n" : "") + movetext(moves) + (headers.Result ? ` ${headers.Result}` : "");
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

/*
 * Coachess handoff. This URL shape is a public contract consumed by
 * two codebases; agreed with the Coachess side on 2026-09-10. Any
 * breaking change must be proposed there first.
 *
 *   /coach/position
 *     ?fen=<START_FEN>                 always sent; required for moves= to parse
 *     &moves=<SAN,comma-separated>     single source of truth for the moves;
 *                                      O-O letters only, replay truncates at
 *                                      the first bad token
 *     [&pov=black]                     when the source page showed Black at the bottom
 *     [&white=&black=&date=&result=]   display metadata; date as YYYY.MM.DD,
 *                                      result 1-0 | 0-1 | 1/2-1/2; no event=, no pgn=
 *     &utm_source=fenshot&utm_medium=extension&utm_campaign=game-import
 *
 * Whole URL stays under 2000 characters: plies are dropped from the
 * end if needed (~350 plies fit, so this is a safety net, not a path
 * real games take).
 */
export const COACHESS_CONTRACT_VERSION = 1;
const COACHESS_POSITION = "https://coachess.app/coach/position";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MAX_URL = 2000;
const RESULT_VALUES = new Set(["1-0", "0-1", "1/2-1/2"]);

function utm(campaign: "game-import" | "position"): string {
  return `utm_source=fenshot&utm_medium=extension&utm_campaign=${campaign}`;
}

/** Position handoff (the existing FEN button), same contract, own campaign tag. */
export function coachessPositionUrl(fen: string, povBlack: boolean): string {
  return `${COACHESS_POSITION}?fen=${encodeURIComponent(fen)}${povBlack ? "&pov=black" : ""}&${utm("position")}`;
}

export function coachessGameUrl(game: FoundGame, povBlack = false): string {
  const h = game.headers;
  const meta: string[] = [];
  if (h.White?.trim()) meta.push(`white=${encodeURIComponent(h.White.trim())}`);
  if (h.Black?.trim()) meta.push(`black=${encodeURIComponent(h.Black.trim())}`);
  if (h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date)) meta.push(`date=${encodeURIComponent(h.Date)}`);
  if (h.Result && RESULT_VALUES.has(h.Result)) meta.push(`result=${encodeURIComponent(h.Result)}`);

  const build = (plies: number) => {
    const moves = game.moves.slice(0, plies).map(encodeURIComponent).join("%2C");
    const parts = [`fen=${encodeURIComponent(START_FEN)}`, `moves=${moves}`];
    if (povBlack) parts.push("pov=black");
    parts.push(...meta, utm("game-import"));
    return `${COACHESS_POSITION}?${parts.join("&")}`;
  };

  let plies = game.moves.length;
  let url = build(plies);
  while (url.length > MAX_URL && plies > 1) url = build(--plies);
  return url;
}
