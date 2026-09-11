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
 * 2. `findGames` runs in the popup. From every "1." it follows the
 *    main line by move number: at each ply the candidates are the
 *    legal moves found after the expected number (or, for Black,
 *    directly after White's move), and when there are several, the
 *    one with the longest legal continuation wins. That is what lets
 *    it read pages where commentary sits between the moves and even
 *    quotes other numbered lines (chessgames kibitzing), and it is
 *    what keeps false positives near zero without any model: random
 *    text almost never forms a legal game.
 */

import { Chess } from "chess.js";

export interface FoundGame {
  /** SAN moves in order, as replayed. */
  moves: string[];
  /**
   * Starting position when the game does not begin from the standard
   * one (a study, a puzzle, a game fragment with a [FEN] tag). Absent
   * for normal games. Always standard chess: variants chess.js cannot
   * replay (Chess960) are not reported at all rather than half-read.
   */
  startFen?: string;
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
  /^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x?[a-h])?(?:[2-7]|[18](?:=?[QRBN])?))[+#]?[!?]{0,2}$/;
const RESULT_AT = /^(1-0|0-1|1\/2-1\/2|\u00bd-\u00bd|\*)(?![\w-])/;
// Whitespace, "!?" marks, NAGs, "e.p.", and evaluation glyphs that sites
// print right after a move (±, ∓, =, +-, -+, ⩲, ⩱, ∞).
const NOISE_AT = /^(?:\s|[!?]|\$\d+|e\.p\.|\[\d+\]|[\u00b1\u2213\u2a72\u2a71\u221e]|\+-|-\+|=\+|\+=|=|[-+](?![0-9]))*/;
/** A result token anywhere (not inside a PGN tag's quotes). */
const RESULT_ANY = /(?<!")(1-0|0-1|1\/2-1\/2|\u00bd-\u00bd|\*)(?![\w-"])/g;
// A new game starts here: the forward search for a move number must
// not cross it, or an unfinished game would splice onto the next one.
const BOUNDARY = /(?<![0-9a-h])1\.(?!\.)|\[Event\s/g;
const TAG = /\[(\w+)\s+"([^"]*)"\]/g;

const MIN_PLIES = 6;
/** How far ahead (chars) the next move number may be: room for a paragraph of commentary. */
const WINDOW = 2500;
/** How many occurrences of the expected number are tried before giving up. */
const MAX_CANDIDATES = 4;
/**
 * Plies of lookahead used to rank competing candidates: effectively
 * the rest of the game. Memoisation on (text position, board) keeps
 * this bounded; the Ranker budget is the safety net.
 */
const LOOKAHEAD = 600;
const MAX_SAN_LEN = 10;

/**
 * Drop {comments}, (variations) and $NAGs. PGN's ";" rest-of-line
 * comments are deliberately not handled: page text is often one long
 * line, and a semicolon in prose would wipe the rest of the game.
 */
function stripAnnotations(s: string): string {
  let t = s
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\$\d+/g, " ")
    // Figurines (♘f3, ♞f6) to letters; pawn figurines just vanish.
    .replace(/[\u2654\u265a]/g, "K")
    .replace(/[\u2655\u265b]/g, "Q")
    .replace(/[\u2656\u265c]/g, "R")
    .replace(/[\u2657\u265d]/g, "B")
    .replace(/[\u2658\u265e]/g, "N")
    .replace(/[\u2659\u265f]/g, "")
    // En/em dashes in results and castling ("1–0", "O–O").
    .replace(/[\u2013\u2014]/g, "-");
  // Variations may nest; peel from the inside out.
  for (let i = 0; i < 6 && /\([^()]*\)/.test(t); i++) t = t.replace(/\([^()]*\)/g, " ");
  return t;
}

function skipNoise(text: string, pos: number): number {
  return pos + NOISE_AT.exec(text.slice(pos, pos + 64))![0].length;
}

interface Step {
  san: string;
  end: number;
  /** No whitespace between the move number (or previous move) and this move. */
  glued: boolean;
}

/** Canonical SAN by its bare form (no check/mate marks, no "="). */
function legalMap(chess: Chess): Map<string, string> {
  const map = new Map<string, string>();
  for (const san of chess.moves()) {
    const bare = san.replace(/[+#]/g, "").replace("=", "");
    map.set(bare, san);
    // Capture without the "x" (chessgames' move table: "dc4", "Bc4").
    // A quiet move of the same spelling cannot be legal at the same
    // time, so the key never collides.
    if (bare.includes("x")) map.set(bare.replace("x", ""), san);
  }
  return map;
}

/**
 * Longest SAN-shaped prefix at `pos` that is legal. Ranks are single
 * digits, so a move glued to the next number ("Rxe129.") still cuts
 * correctly; an over-disambiguated read ("Kf1g5") is not legal and
 * the shorter "Kf1" wins. One move generation per call site (the
 * `legal` map), no board mutation.
 */
function parseMoveAt(chess: Chess, legal: Map<string, string>, text: string, pos: number): Step | null {
  const max = Math.min(MAX_SAN_LEN, text.length - pos);
  const castleLong = /^(?:O-O-O|0-0-0)/.test(text.slice(pos, pos + 5));
  for (let len = max; len >= 2; len--) {
    const sub = text.slice(pos, pos + len);
    if (!SAN.test(sub)) continue;
    // "O-O-O" must never be read as "O-O" plus leftovers.
    if (castleLong && !/^(?:O-O-O|0-0-0)/.test(sub)) break;
    const bare = sub
      .replace(/[!?]+$/, "")
      .replace(/^0-0-0/, "O-O-O")
      .replace(/^0-0/, "O-O")
      .replace(/[+#]/g, "")
      .replace("=", "");
    const san = legal.get(bare);
    if (san) return { san, end: pos + len, glued: false };
    // Over-disambiguated forms ("Nbd7" where "Nd7" is unique) are not
    // in the map; chess.js accepts them, so ask it, but only for those.
    if (/^[KQRBN][a-h1-8]/.test(bare) && bare.length >= 4) {
      try {
        const mv = chess.move(bare);
        chess.undo();
        return { san: mv.san, end: pos + len, glued: false };
      } catch {
        /* not a move */
      }
    }
  }
  return null;
}

/**
 * Positions right after every plausible marker for move `n` within the
 * window: "12." / "12 " / "12e4" (bare, glued) for White, "12..." for
 * Black. A marker at the cursor is always accepted; further ahead it
 * must not be preceded by a digit, so "1." inside "11." or a year never
 * counts. Letters before it are fine: chessgames glues commentary to
 * the next marker ("-- Wade11...Na4").
 */
function markers(text: string, from: number, n: number, black: boolean, limit = MAX_CANDIDATES): number[] {
  const out: number[] = [];
  const num = String(n);
  // Anchors (n = 1) are searched over the whole text; later numbers
  // only within a window, and never across the start of another game.
  let stop = n === 1 ? text.length : Math.min(text.length, from + WINDOW);
  if (n > 1) {
    BOUNDARY.lastIndex = from;
    const b = BOUNDARY.exec(text);
    if (b && b.index < stop) stop = b.index;
  }
  for (let i = text.indexOf(num, from); i >= 0 && i < stop && out.length < limit; i = text.indexOf(num, i + 1)) {
    // A digit right before is a rank ("Qxc5" + "18.") only when a file
    // letter precedes it; otherwise it is part of a longer number.
    if (i > from && /[0-9]/.test(text[i - 1]) && !/[a-h]/.test(text[i - 2] ?? "")) continue;
    const after = text.slice(i + num.length, i + num.length + 3);
    if (black) {
      if (after === "...") out.push(i + num.length + 3);
    } else if (after.startsWith("...")) {
      continue;
    } else if (after.startsWith(".")) {
      out.push(i + num.length + 1);
    } else if (/^[\s]/.test(after) || /^[KQRBNOa-h]/.test(after)) {
      out.push(i + num.length);
    }
  }
  return out;
}

/**
 * All legal moves that could be the next ply: after each marker for
 * the expected number, and (for Black, whose number is usually
 * omitted) directly at the cursor.
 */
function candidates(chess: Chess, text: string, pos: number, n: number, black: boolean, first = false): Step[] {
  const out: Step[] = [];
  const seenEnd = new Set<number>();
  const legal = legalMap(chess);
  const tryAt = (p: number) => {
    const at = skipNoise(text, p);
    const step = parseMoveAt(chess, legal, text, at);
    if (!step || seenEnd.has(step.end)) return;
    step.glued = !/\s/.test(text.slice(p, at));
    // The same SAN at two places is two candidates: "6.Bg5 or 6.Be3
    // are playable; the game went 6.Bg5 e6" continues only from the
    // second one. Lookahead tells them apart.
    seenEnd.add(step.end);
    out.push(step);
  };
  // White's move is always introduced by its number, so prose that
  // happens to start with a legal move never counts; Black's usually
  // follows directly. The very first ply comes right after the "1."
  // marker the caller found: direct only, other games' "1." are not
  // candidates for this one.
  if (first) {
    tryAt(pos);
    return out;
  }
  if (black) tryAt(pos);
  for (const p of markers(text, pos, n, black)) tryAt(p);
  return out;
}

/** Result token right after a move (past annotations), normalised. */
function resultAt(text: string, pos: number): string | undefined {
  const p = skipNoise(text, pos);
  const r = RESULT_AT.exec(text.slice(p, p + 8));
  if (!r) return undefined;
  return r[1] === "\u00bd-\u00bd" ? "1/2-1/2" : r[1];
}

/**
 * Depth of the longest legal line reachable from a position in the
 * text, up to `left` plies. Forks are searched, not guessed: a quoted
 * alternative that keeps going for a while still loses to the main
 * line if the main line goes further. Memoised on (text position,
 * board) so converging paths cost once; a budget bounds pathological
 * texts, after which the search degrades to greedy.
 */
class Ranker {
  /** key -> [depth, budget it was computed with]. */
  private memo = new Map<string, [number, number]>();
  private budget = 6_000;
  constructor(private text: string) {}

  depth(chess: Chess, pos: number, n: number, black: boolean, left: number): number {
    if (left === 0 || resultAt(this.text, pos)) return 0;
    const key = `${pos}|${n}|${black}|${chess.fen().split(" ").slice(0, 3).join(" ")}`;
    const hit = this.memo.get(key);
    // Reusable when it ended naturally (depth below its cap) or was
    // computed with at least this much budget; a capped value from a
    // shallower visit would understate the line.
    if (hit && (hit[0] < hit[1] || hit[1] >= left)) return Math.min(hit[0], left);
    const cands = candidates(chess, this.text, pos, n, black);
    let best = 0;
    for (const c of cands) {
      this.budget -= 1;
      chess.move(c.san);
      const d = 1 + this.depth(chess, c.end, black ? n + 1 : n, !black, left - 1);
      chess.undo();
      if (d > best) best = d;
      if (best === left || this.budget <= 0) break; // cannot do better / out of budget: greedy from here
    }
    this.memo.set(key, [best, left]);
    return best;
  }
}

/**
 * Follow the main line from a "1." marker. Commentary between moves,
 * even commentary that quotes other numbered moves ("18. Bxe6 leads
 * to..."), is survived by asking, at every ply, which candidate has
 * the longest legal continuation: a side line dies within a few plies,
 * the main line does not.
 */
function scanLine(text: string, start: number, fen?: string): { moves: string[]; result?: string; end: number } {
  const chess = new Chess(fen);
  const moves: string[] = [];
  const ranker = new Ranker(text);
  let pos = start;
  let n = parseInt(chess.fen().split(" ")[5], 10) || 1;
  let black = chess.turn() === "b";
  for (;;) {
    const cands = candidates(chess, text, pos, n, black, moves.length === 0);
    if (cands.length === 0) break;
    let best = cands[0];
    if (cands.length > 1) {
      // Longest legal continuation wins. Iterative deepening: most
      // quoted alternatives die within a few plies, so compare at a
      // small horizon first and only search deeper while candidates
      // are still level. On a final tie (typically near the end of the
      // game, where a quoted alternative can finish just as long), a
      // move glued to its number beats a spaced one: sites that
      // interleave commentary render the real moves glued and the
      // quotes as prose. Then text order.
      let alive = cands;
      for (let cap = 6; ; cap *= 2) {
        const horizon = Math.min(cap, LOOKAHEAD);
        const depths = alive.map((c) => {
          chess.move(c.san);
          const d = 1 + ranker.depth(chess, c.end, black ? n + 1 : n, !black, horizon - 1);
          chess.undo();
          return d;
        });
        const top = Math.max(...depths);
        alive = alive.filter((_, i) => depths[i] === top);
        if (alive.length === 1 || top < horizon || horizon === LOOKAHEAD) break;
      }
      best = alive.find((c) => c.glued) ?? alive[0];
    }
    chess.move(best.san);
    moves.push(best.san);
    pos = best.end;
    const r = resultAt(text, pos);
    if (r) return { moves, result: r, end: pos };
    if (black) n += 1;
    black = !black;
  }
  // No more moves. If the expected number is still ahead, the line was
  // cut by an unreadable move and the game's outcome is not ours to
  // claim. Otherwise a result may follow after a few words ("Rc2#
  // White resigned. 0-1"), as long as no new game starts first.
  if (markers(text, pos, n, black, 1).length > 0) return { moves, end: pos };
  const tail = text.slice(pos, pos + 200);
  BOUNDARY.lastIndex = 0;
  const b = BOUNDARY.exec(tail);
  RESULT_ANY.lastIndex = 0;
  const r = RESULT_ANY.exec(tail);
  if (r && (!b || r.index < b.index)) return { moves, result: r[1] === "\u00bd-\u00bd" ? "1/2-1/2" : r[1], end: pos };
  return { moves, end: pos };
}

function headersBefore(text: string, at: number): Record<string, string> {
  let window = text.slice(Math.max(0, at - 1500), at);
  // Tags belong to this game only if no earlier game ended in between.
  const ends = [...window.matchAll(RESULT_ANY)];
  const last = ends.at(-1);
  if (last) window = window.slice(last.index + last[0].length);
  const headers: Record<string, string> = {};
  for (const m of window.matchAll(TAG)) headers[m[1]] = m[2];
  return headers;
}

function movetext(moves: string[], fen?: string): string {
  const parts: string[] = [];
  let n = 1;
  let black = false;
  if (fen) {
    const f = fen.split(" ");
    black = f[1] === "b";
    n = parseInt(f[5], 10) || 1;
  }
  for (let i = 0; i < moves.length; i++) {
    if (i === 0 && black) parts.push(`${n}...`);
    else if (!black) parts.push(`${n}.`);
    parts.push(moves[i]);
    if (black) n += 1;
    black = !black;
  }
  return parts.join(" ");
}

/** chess.js wants six fields; PGN tags sometimes carry four. */
function normalizeFen(fen: string): string {
  const f = fen.trim().split(/\s+/);
  while (f.length < 6) f.push(f.length === 4 ? "0" : "1");
  return f.join(" ");
}

/** Loadable by chess.js, i.e. standard chess. X-FEN castling (Chess960) is not. */
function loadableFen(fen: string): string | null {
  try {
    return new Chess(normalizeFen(fen)).fen();
  } catch {
    return null;
  }
}

const TAG_BLOCK = /(?:\[\w+\s+"[^"]*"\]\s*){1,}/g;

/**
 * PGN header blocks and what they say about the starting position.
 * `fen` is set for a loadable non-standard start; `unsupported` when
 * the game cannot be replayed: a non-standard [Variant], a FEN chess.js
 * rejects (Chess960's X-FEN castling), or [SetUp "1"] whose FEN is not
 * on the page at all (chessgames prints the PGN without it).
 */
function headerBlocks(text: string): { end: number; fen?: string; unsupported: boolean }[] {
  const out: { end: number; fen?: string; unsupported: boolean }[] = [];
  for (const m of text.matchAll(TAG_BLOCK)) {
    const tags: Record<string, string> = {};
    for (const t of m[0].matchAll(TAG)) tags[t[1]] = t[2];
    const variant = tags.Variant && !/^(standard|normal|chess|from position)$/i.test(tags.Variant.trim());
    const fen = tags.FEN ? loadableFen(tags.FEN) : null;
    const unsupported = !!variant || (!!tags.FEN && !fen) || (tags.SetUp === "1" && !tags.FEN);
    const end = m.index + m[0].length;
    if (unsupported) out.push({ end, unsupported: true });
    else if (fen && fen !== START_FEN) out.push({ end, fen, unsupported: false });
  }
  return out;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function labelFor(headers: Record<string, string>, moves: string[]): string {
  const n = Math.ceil(moves.length / 2);
  const w = headers.White?.trim();
  const b = headers.Black?.trim();
  const year = headers.Date?.match(/\d{4}/)?.[0];
  const who = w && b ? `${w} \u2013 ${b}` : headers.Event?.trim() || "Game";
  return `${who}${year ? `, ${year}` : ""} (${n} move${n === 1 ? "" : "s"})`;
}


/** First few move-like tokens after `from`, no legality: to fingerprint a game we cannot replay. */
function roughPrefix(text: string, from: number, count: number): string[] {
  const out: string[] = [];
  const re = /(?:\d{1,3}\.(?:\.\.)?\s*)?([KQRBNO][a-h1-8x=+#O-]*|[a-h][a-h1-8x=+#QRBN]*)/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while (out.length < count && (m = re.exec(text.slice(0, from + 400)))) {
    if (m.index < from) continue;
    out.push(m[1].replace(/[x+#=]/g, ""));
  }
  return out;
}

export function findGames(texts: string[]): FoundGame[] {
  const games: FoundGame[] = [];
  const seen = new Set<string>();

  for (const raw of texts) {
    const text = stripAnnotations(raw);
    type Line = { start: number; end: number; moves: string[]; result?: string; fen?: string };
    const lines: Line[] = [];
    const unsupported: string[][] = [];

    // Games that declare a starting position. Standard chess: scan
    // from the first marker for that position's move number and side.
    // Anything chess.js cannot load (Chess960's X-FEN castling, other
    // variants) is fingerprinted so that a half-legal read of the same
    // moves from the standard start is suppressed below: a wrong game
    // is worse than none.
    for (const block of headerBlocks(text)) {
      const after = block.end;
      if (block.unsupported) {
        unsupported.push(roughPrefix(text, after, 4));
        continue;
      }
      const fen = block.fen!;
      const f = fen.split(" ");
      const n0 = parseInt(f[5], 10) || 1;
      const black = f[1] === "b";
      const [at] = markers(text, after, n0, black, 1);
      if (at === undefined) continue;
      const line = scanLine(text, at, fen);
      if (line.moves.length >= MIN_PLIES) lines.push({ start: at, ...line, fen });
    }

    // Every "1." (or "1 e4", "1e4") is a possible game start.
    for (const start of markers(text, 0, 1, false, Infinity)) {
      const line = scanLine(text, start);
      if (line.moves.length < MIN_PLIES) continue;
      if (unsupported.some((u) => u.length >= 4 && u.every((m, i) => line.moves[i]?.replace(/[x+#=]/g, "") === m))) continue;
      lines.push({ start, ...line });
    }

    // Lines whose text spans overlap are the same game seen from
    // different anchors (a "1. d4 was better" quote inside commentary,
    // or a quoted alternative first move): games do not nest, so only
    // the longest line of an overlapping group survives.
    lines.sort((a, b) => b.moves.length - a.moves.length || a.start - b.start);
    const kept: Line[] = [];
    for (const line of lines) {
      if (kept.some((k) => line.start < k.end && k.start < line.end)) continue;
      kept.push(line);
    }
    kept.sort((a, b) => a.start - b.start);

    for (const line of kept) {
      const moves = line.moves;
      const key = (line.fen ? line.fen + "|" : "") + moves.join(" ");
      if (seen.has(key)) continue;
      // The same game often appears twice on a page (move table plus a
      // PGN textarea), sometimes truncated. Keep only the longest
      // rendering: skip a prefix of a known game, and evict known games
      // that are prefixes of this one.
      if ([...seen].some((k) => k.startsWith(key + " "))) continue;
      for (let g = games.length - 1; g >= 0; g--) {
        const k = (games[g].startFen ? games[g].startFen + "|" : "") + games[g].moves.join(" ");
        if (key.startsWith(k + " ")) {
          games.splice(g, 1);
          seen.delete(k);
        }
      }
      seen.add(key);
      const headers = headersBefore(text, Math.max(0, line.start - 2));
      // A result token closing the move list counts as a header when
      // the page has no PGN tag for it.
      if (!headers.Result && line.result) headers.Result = line.result;
      if (line.fen) {
        headers.SetUp = "1";
        headers.FEN = line.fen;
      } else {
        delete headers.SetUp;
        delete headers.FEN;
      }
      const tagLines = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`);
      const pgn =
        (tagLines.length ? tagLines.join("\n") + "\n\n" : "") +
        movetext(moves, line.fen) +
        (headers.Result ? ` ${headers.Result}` : "");
      games.push({ moves, headers, pgn, label: labelFor(headers, moves), ...(line.fen ? { startFen: line.fen } : {}) });
    }
  }
  // Longest first: on a page with one main game plus snippets, the
  // main game is what the user came for.
  return games.sort((a, b) => b.moves.length - a.moves.length);
}

/**
 * Lichess parses the path as PGN, tag pairs included; "_" and "+" are
 * turned into spaces server-side, so everything goes through
 * encodeURIComponent ("+" in checks becomes %2B).
 */
export function lichessGameUrl(game: FoundGame): string {
  const moves = game.moves.map(encodeURIComponent).join("_");
  const fenTag = game.startFen ? encodeURIComponent(`[FEN "${game.startFen}"]`) + "_" : "";
  return `https://lichess.org/analysis/pgn/${fenTag}${moves}`;
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
    const parts = [`fen=${encodeURIComponent(game.startFen ?? START_FEN)}`, `moves=${moves}`];
    if (povBlack) parts.push("pov=black");
    parts.push(...meta, utm("game-import"));
    return `${COACHESS_POSITION}?${parts.join("&")}`;
  };

  let plies = game.moves.length;
  let url = build(plies);
  while (url.length > MAX_URL && plies > 1) url = build(--plies);
  return url;
}
