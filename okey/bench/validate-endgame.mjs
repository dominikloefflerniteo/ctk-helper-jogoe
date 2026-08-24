// Does the exact solver tell the truth? Take random positions, read the
// predicted P(reach N more points), then actually play the position out many
// times following the solver's own advice and compare.
import { EndgameSolver, maskOf, indexToCard, popcount } from "../endgame.js";
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
const rand = makeRng(7);

function randomPosition(size) {
  const all = [];
  for (const c of COLORS) for (const v of VALUES) all.push(`${c}${v}`);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const cards = all.slice(0, size);
  return { available: maskOf(cards), board: maskOf(cards.slice(0, 5)) };
}

function bitsOf(mask) {
  const out = [];
  for (let i = 0; i < 24; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

// Play the position out following the solver, drawing at random.
function playOut(solver, available, board, need) {
  let score = 0;
  let a = available, b = board;
  for (let guard = 0; guard < 40; guard++) {
    if (bitsOf(b).length < 3) break;
    const move = solver.bestMove(a, b, Math.max(0, need - score), true);
    if (!move) break;
    const maskFor = (cards) => maskOf(cards);
    if (move.kind === "pick") {
      score += move.gained;
      const hand = maskFor(move.cards);
      a &= ~hand; b &= ~hand;
      const deck = bitsOf(a & ~b);
      for (let n = 0; n < 3 && deck.length; n++) {
        const idx = Math.floor(rand() * deck.length);
        b |= 1 << deck[idx];
        deck.splice(idx, 1);
      }
    } else {
      const card = maskFor(move.cards);
      a &= ~card; b &= ~card;
      const deck = bitsOf(a & ~b);
      if (deck.length) {
        const idx = Math.floor(rand() * deck.length);
        b |= 1 << deck[idx];
      }
    }
  }
  return score;
}

const TRIALS = 4000;
console.log("size  need  predicted   measured   diff");
for (const size of [8, 9, 10, 11, 12]) {
  for (let rep = 0; rep < 4; rep++) {
    const { available, board } = randomPosition(size);
    const solver = new EndgameSolver();
    const curve = solver.solve(available, board);
    // Only the UNCERTAIN thresholds are a real test — a prediction of 0.0 or
    // 1.0 is confirmed by any correct implementation. Pick the thresholds
    // where the solver claims a genuine coin-flip.
    const interesting = [];
    for (let i = 1; i < curve.length; i++) {
      if (curve[i] > 0.05 && curve[i] < 0.95) interesting.push(i * 10);
    }
    if (interesting.length === 0) continue;
    const step = Math.max(1, Math.floor(interesting.length / 3));
    for (const need of interesting.filter((_, i) => i % step === 0).slice(0, 3)) {
      const idx = Math.ceil(need / 10);
      const predicted = curve[idx];
      // The table stays valid across trials: every state reached is a
      // sub-state of the root, and NT does not change. Clearing it per trial
      // (as a first version did) makes this run for hours instead of seconds.
      let hits = 0;
      for (let t = 0; t < TRIALS; t++) {
        if (playOut(solver, available, board, need) >= need) hits++;
      }
      const measured = hits / TRIALS;
      console.log(
        String(size).padStart(4) + String(need).padStart(6) +
        predicted.toFixed(3).padStart(11) + measured.toFixed(3).padStart(11) +
        (measured - predicted).toFixed(3).padStart(8));
    }
  }
}
