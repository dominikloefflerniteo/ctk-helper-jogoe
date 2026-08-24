// How much is actually on the table? Upper bound per game, by hindsight.
//
// The deck is 24 known cards; the only unknown is the ORDER they arrive in.
// So for a fixed shuffle we can compute the highest score a player could have
// scored if they had known the order in advance — exact, by dynamic
// programming. That number is the ceiling no policy can pass, and the gap
// between it and the solver tells us whether more solver work is worth doing.
//
// State: (how many cards have been drawn, which cards are on the board).
// Everything else — what was picked, what was discarded, the score so far —
// does not affect what is still achievable, so it stays out of the key.
//
// Usage: node bench/ceiling.mjs [games]

import { scoreHand, COLORS, VALUES } from "../game.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fullDeck() {
  const out = [];
  for (const c of COLORS) for (const v of VALUES) out.push(`${c}${v}`);
  return out;
}

function shuffled(rand) {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const combos3 = [];
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 4; j++) for (let k = j + 1; k < 5; k++) combos3.push([i, j, k]);

// Best total still reachable from (drawn, board), playing with full knowledge
// of the remaining order.
function solve(order, drawn, board, memo) {
  const key = drawn + "|" + [...board].sort().join(",");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  let best = 0;
  const cards = board.filter(Boolean);

  // Pick any 3.
  if (cards.length >= 3) {
    for (const [a, b, c] of combos3) {
      if (a >= cards.length || b >= cards.length || c >= cards.length) continue;
      const hand = [cards[a], cards[b], cards[c]];
      const gained = scoreHand(hand).score;
      const rest = cards.filter((x) => !hand.includes(x));
      let nextDrawn = drawn;
      const nextBoard = [...rest];
      while (nextBoard.length < 5 && nextDrawn < order.length) nextBoard.push(order[nextDrawn++]);
      const total = gained + solve(order, nextDrawn, nextBoard, memo);
      if (total > best) best = total;
    }
  }

  // Discard one — only worth it while there is a card to replace it with.
  if (drawn < order.length) {
    for (let i = 0; i < cards.length; i++) {
      const rest = cards.filter((_, j) => j !== i);
      let nextDrawn = drawn;
      const nextBoard = [...rest];
      while (nextBoard.length < 5 && nextDrawn < order.length) nextBoard.push(order[nextDrawn++]);
      const total = solve(order, nextDrawn, nextBoard, memo);
      if (total > best) best = total;
    }
  }

  memo.set(key, best);
  return best;
}

const games = Number(process.argv[2] || 200);
const rand = makeRng(1);
let sum = 0, gold = 0, silver = 0;
const scores = [];
for (let g = 0; g < games; g++) {
  const order = shuffled(rand);
  const board = order.slice(0, 5);
  const best = solve(order, 5, board, new Map());
  scores.push(best);
  sum += best;
  if (best >= 400) gold++;
  if (best >= 300) silver++;
}
scores.sort((a, b) => a - b);
console.log(`hindsight-optimal play, ${games} games (seed 1)`);
console.log(`  avg ${(sum / games).toFixed(1)}   median ${scores[Math.floor(games / 2)]}   min ${scores[0]}   max ${scores[games - 1]}`);
console.log(`  reaches gold (>=400): ${(gold / games * 100).toFixed(1)}%   silver (>=300): ${(silver / games * 100).toFixed(1)}%`);
