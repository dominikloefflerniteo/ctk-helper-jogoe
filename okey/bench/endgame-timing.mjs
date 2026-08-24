// What would it cost to play EXACTLY from turn one?
//
// Times one exact solve for every stage of the game, measured by how many
// cards are still in play. Turn 1 has all 24; each pick removes 3 and each
// discard 1, so a real game walks this table downwards.
//
// Usage: node --max-old-space-size=6000 bench/endgame-timing.mjs [nodeLimit]

import { EndgameSolver, maskOf } from "../endgame.js";
import { COLORS, VALUES } from "../game.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPosition(rand, size) {
  const all = [];
  for (const c of COLORS) for (const v of VALUES) all.push(`${c}${v}`);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const cards = all.slice(0, size);
  return { available: maskOf(cards), board: maskOf(cards.slice(0, 5)) };
}

const nodeLimit = Number(process.argv[2] || 3e6);
const rand = makeRng(3);

console.log(`exact solve cost by stage of game (node limit ${nodeLimit.toExponential(0)})`);
console.log("");
console.log("cards left  round   states      time      verdict");
console.log("-".repeat(62));

for (const size of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 21, 24]) {
  const { available, board } = randomPosition(rand, size);
  const solver = new EndgameSolver({ nodeLimit });
  const t0 = process.hrtime.bigint();
  let verdict = "";
  let ok = true;
  try {
    solver.solve(available, board);
  } catch (e) {
    ok = false;
    verdict = "ABORTED (over node limit)";
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // Turn number a real game is on when this many cards remain: the first turn
  // has 24 cards, and turns remove 1 (discard) or 3 (pick) — roughly 2 per
  // turn in observed play.
  const round = Math.max(1, Math.round((24 - size) / 2) + 1);
  if (ok) {
    verdict = ms < 100 ? "instant" : ms < 1000 ? "fine live" : ms < 10000 ? "needs a worker" : "too slow live";
  }
  console.log(
    String(size).padStart(9) + String(round).padStart(7) +
    solver.nodes.toLocaleString("en-US").padStart(11) +
    (ms < 1000 ? ms.toFixed(0) + " ms" : (ms / 1000).toFixed(1) + " s").padStart(11) +
    "      " + verdict);
  if (!ok) break;
}
