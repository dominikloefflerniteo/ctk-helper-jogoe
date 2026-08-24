// Where do the points go? Plays N games with the current default policy and
// breaks the result down by pick type, pick value, and what was left on the
// table when the deck ran out. Diagnostic only — no tuning here.
import { createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, scoreHand, chestForScore } from "../game.js";
import { suggestMove } from "../solver.js";
import { makeAvailableSet, deckPotential, potentialOf } from "../potential.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const games = Number(process.argv[2] || 2000);
const rand = makeRng(1);
const types = { three: [0, 0], sameSeq: [0, 0], mixedSeq: [0, 0], none: [0, 0] };
let totalScore = 0, totalPicks = 0, totalDiscards = 0, leftoverPot = 0, leftoverCards = 0;
const discardedPotential = [];
const startPot = deckPotential(makeAvailableSet(
  [...Array(24)].map((_, i) => "RBY"[Math.floor(i / 8)] + (i % 8 + 1)), []));

for (let g = 0; g < games; g++) {
  const state = createState();
  let safety = 60;
  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;
    const move = suggestMove(state);
    if (!move) break;
    if (move.kind === "discard") {
      if (deckRemaining(state).length === 0) break;
      const card = state.board[move.slots[0]];
      const avail = makeAvailableSet(deckRemaining(state), state.board);
      discardedPotential.push(potentialOf(card, avail));
      discardSlot(state, move.slots[0]);
      totalDiscards++;
      continue;
    }
    const hand = move.slots.map((i) => state.board[i]);
    const { type, score } = scoreHand(hand);
    types[type][0]++; types[type][1] += score;
    confirmPick(state, move.slots);
    totalPicks++;
  }
  totalScore += state.score;
  const rest = deckRemaining(state);
  leftoverCards += rest.length + filledCards(state).length;
  leftoverPot += deckPotential(makeAvailableSet(rest, state.board));
}

const avg = (x) => (x / games).toFixed(2);
console.log(`${games} games — avg score ${(totalScore / games).toFixed(1)}`);
console.log(`full-deck potential (greedy packing of all 24 cards): ${startPot} pts`);
console.log("");
console.log("pick type      count/game   avg pts   share of score");
for (const [t, [n, pts]] of Object.entries(types)) {
  if (!n) continue;
  console.log(
    t.padEnd(12) + avg(n).padStart(10) + (pts / n).toFixed(1).padStart(10) +
    (pts / totalScore * 100).toFixed(1).padStart(14) + "%");
}
console.log("");
console.log(`picks/game      ${avg(totalPicks)}`);
console.log(`discards/game   ${avg(totalDiscards)}   avg potential thrown away: ${(discardedPotential.reduce((a, b) => a + b, 0) / discardedPotential.length).toFixed(1)}`);
console.log(`cards unplayed at end: ${avg(leftoverCards)}  (their combo potential: ${avg(leftoverPot)} pts)`);
