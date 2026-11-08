// Finds real chess screenshots posted on Reddit that another, independently
// built reader also answered: in practice the chessvision-ai-bot comment that
// gives the position as an analysis link. Source: the public Arctic Shift
// Reddit archive (Reddit blocks automated reads).
//
//   node tools/benchmark/reddit-collect.mjs [--posts 2000]
//
// Writes .tmp/benchmark/reddit/candidates.json and downloads the images
// (not committed: they belong to their posters). How the bot's reading is
// used as truth, and why every disagreement counts against fenshot, is in
// README.md and reddit-finalize.py.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const API = "https://arctic-shift.photon-reddit.com/api";
const OUT = ".tmp/benchmark/reddit";
const SUBS = ["chessbeginners", "chess", "TournamentChess", "chessquestions"];
const target = Number(process.argv[process.argv.indexOf("--posts") + 1]) || 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) {
      const j = await res.json().catch(() => null);
      if (j?.data) return j.data;
    }
    await sleep(3000 * (i + 1));
  }
  return [];
}

const PLACEMENT = "((?:[pnbrqkPNBRQK1-8]{1,8}/){7}[pnbrqkPNBRQK1-8]{1,8})";
const PATTERNS = [
  new RegExp(`lichess\\.org/(?:analysis|editor)/(?:standard/|fromPosition/)?${PLACEMENT}`),
  new RegExp(`chess\\.com/analysis\\?fen=${PLACEMENT.replace(/\//g, "(?:/|%2F)")}`, "i"),
  new RegExp(`(?:^|[\\s\`"'(])${PLACEMENT}[ _]+[wb](?:[ _]|$)`),
];

function validPlacement(p) {
  const rows = p.split("/");
  return rows.length === 8 && rows.every((r) => [...r].reduce((n, ch) => n + (/\d/.test(ch) ? Number(ch) : 1), 0) === 8);
}

function findPosition(body) {
  const text = body.replace(/%2F/gi, "/").replace(/\\_/g, "_");
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m && validPlacement(m[1])) return m[1];
  }
  return null;
}

async function imagePosts(sub, before) {
  const url = `${API}/posts/search?subreddit=${sub}&limit=100&sort=desc&before=${before}&fields=id,title,url,created_utc`;
  return get(url);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const prior = existsSync(join(OUT, "candidates.json")) ? JSON.parse(readFileSync(join(OUT, "candidates.json"), "utf8")) : [];
  const seen = new Set(prior.map((c) => c.postId));
  const candidates = [...prior];
  let scanned = 0;
  for (const sub of SUBS) {
    let before = Math.floor(Date.now() / 1000);
    while (scanned < target * ((SUBS.indexOf(sub) + 1) / SUBS.length)) {
      const posts = await imagePosts(sub, before);
      if (!posts.length) break;
      before = posts[posts.length - 1].created_utc;
      for (const p of posts) {
        if (!/^https:\/\/i\.redd\.it\/.+\.(png|jpe?g)$/i.test(p.url || "") || seen.has(p.id)) continue;
        scanned++;
        const comments = await get(`${API}/comments/search?link_id=${p.id}&limit=100&fields=id,body,author`);
        await sleep(400);
        for (const c of comments) {
          const placement = findPosition(c.body || "");
          if (!placement) continue;
          const res = await fetch(p.url).catch(() => null);
          if (!res?.ok) break;
          const file = `reddit-${p.id}.${p.url.split(".").pop().toLowerCase()}`;
          writeFileSync(join(OUT, file), Buffer.from(await res.arrayBuffer()));
          candidates.push({ postId: p.id, sub, title: p.title, permalink: `https://www.reddit.com/r/${sub}/comments/${p.id}/`, image: p.url, file, commentId: c.id, placement, created: p.created_utc });
          seen.add(p.id);
          console.log(`HIT ${sub} ${p.id} ${placement}`);
          break;
        }
      }
      writeFileSync(join(OUT, "candidates.json"), JSON.stringify(candidates, null, 1));
      console.log(`${sub}: scanned ${scanned} image posts, ${candidates.length} candidates`);
    }
  }
}

main();
