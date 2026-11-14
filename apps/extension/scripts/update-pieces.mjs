// fenshot's chess pieces, taken from their one source: the Kibitzo piece
// set, drawn in the Lightsquare repository (piece-sets/kibitzo.svg, CC BY
// 4.0, (c) Danubian Research AG).
//   node apps/extension/scripts/update-pieces.mjs [path to kibitzo.svg]
// Writes the two forms this repository reads, so they cannot disagree:
//   apps/extension/src/pieces-svg/<wK ... bP>.svg     one picture a piece, which the
//                                                     popup's src/pieces.ts bundles as text
//   apps/web/public/cm-chessboard/pieces/kibitzo.svg  the whole sprite, for fenshot.com's board
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const source = process.argv[2] ?? `${homedir()}/git/lightsquare/piece-sets/kibitzo.svg`;
const sprite = readFileSync(source, "utf8");
const out = new URL("../src/pieces-svg/", import.meta.url);

/** The whole <g id="..."> element of a piece, nested groups included. */
function group(id) {
  const start = sprite.indexOf(`<g id="${id}"`);
  if (start < 0) throw new Error(`the sprite has no <g id="${id}">`);
  const tags = /<g[\s>]|<\/g>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(sprite); m; m = tags.exec(sprite)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return sprite.slice(start, m.index + 4);
  }
  throw new Error(`<g id="${id}"> is not closed`);
}

const box = /viewBox="([^"]+)"/.exec(sprite)?.[1];
if (!box) throw new Error("the sprite has no viewBox");
for (const colour of ["w", "b"]) {
  for (const piece of ["K", "Q", "R", "B", "N", "P"]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${group(colour + piece.toLowerCase())}</svg>\n`;
    writeFileSync(new URL(`${colour}${piece}.svg`, out), svg);
  }
}
writeFileSync(new URL("../../web/public/cm-chessboard/pieces/kibitzo.svg", import.meta.url), sprite);
console.log(`the extension's pieces and fenshot.com's sprite written from ${source}`);
