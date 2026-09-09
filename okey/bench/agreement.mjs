// How often does the helper play a move that is not optimal, and what does it
// cost when it does?
//
// Chest rates answer "does the average run end better", which is the question
// the player asks least. What they actually notice is a single suggestion that
// looks wrong — and a config can lift the average while getting more individual
// positions wrong, because most positions do not decide the run.
//
// So: play games with the config under test, and at every decision small enough
// to solve outright, ask the exact solver what the best move is. Two numbers
// come out of that:
//
//   disagreement rate — how often the shown move is not an optimal one
//   cost when wrong   — how much chest value (pSilver + 2*pGold, the solver's
//                       own currency) the shown move gives up
//
// A move is only counted wrong if it is strictly worse: several moves are often
// exactly tied, and picking a different one of them is not an error.
//
// Positions with more cards than the exact solver can take are skipped, not
// guessed at — this measures where certainty exists.
//
// Usage:
//   node bench/agreement.mjs [games] [--seed=1] [--only=before,bandSilver]
//   node bench/agreement.mjs 200 --window=13

import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, CHEST_THRESHOLDS,
} from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";
import { suggestMove } from "../solver.js";
import { EndgameSolver, maskOf } from "../endgame.js";

const CONFIGS = {
  before: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0 },
  bandAll: { exactMaxCards: 12, exactLeaf: 0, tieZ: 1.0 },
  bandSilver: { exactMaxCards: 12, exactLeaf: 0, tieZ: { pSilver: 1.0, balanced: 1.0, pGold: 0 } },
  bandSilver13: { exactMaxCards: 13, exactLeaf: 0, tieZ: { pSilver: 1.0, balanced: 1.0, pGold: 0 } },
  exact13: { exactMaxCards: 13, exactLeaf: 0, tieZ: 0 },
};

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (kind, cards) => kind + ":" + [...cards].sort().join(",");

// Exact value of every legal move in this position, in the solver's currency.
function truth(state, window) {
  const deck = deckRemaining(state);
  const board = state.board.filter(Boolean);
  if (deck.length + board.length > window) return null;
  const available = maskOf([...deck, ...board]);
  const solver = new EndgameSolver({ nodeLimit: 5e6 });
  solver.prepare(available);
  let best;
  try {
    best = solver.bestMoveChest(
      available, maskOf(board),
      CHEST_THRESHOLDS.silver - state.score,
      CHEST_THRESHOLDS.gold - state.score,
      true,
    );
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  if (!best || !best.all) return null;
  const byKey = new Map();
  for (const c of best.all) {
    byKey.set(key(c.kind, c.cards), c.pSilver + 2 * c.pGold);
  }
  return { byKey, best: Math.max(...byKey.values()) };
}

function runConfig(name, games, seed, window) {
  const opts = CONFIGS[name];
  const rand = makeRng(seed);
  let decisions = 0, wrong = 0, cost = 0, worst = 0;

  for (let g = 0; g < games; g++) {
    const state = createState();
    const cache = createPolicyCache();
    let safety = 60;
    while (safety-- > 0) {
      autoFillBoardFromDeck(state, rand);
      if (filledCards(state).length < 3) break;

      const move = suggest(state, { ...opts, cache });
      if (!move) break;

      // Judged BEFORE the move is played, against a solver of its own so the
      // config's cache cannot colour the verdict.
      const t = truth(state, window);
      if (t) {
        const got = t.byKey.get(key(move.kind, move.cards));
        if (got !== undefined) {
          decisions++;
          const gap = t.best - got;
          if (gap > 1e-6) { wrong++; cost += gap; if (gap > worst) worst = gap; }
        }
      }

      if (move.kind === "discard") {
        if (deckRemaining(state).length === 0) {
          const forced = suggestMove(state, { policy: "v1", opportunityCost: Infinity });
          if (!forced || forced.kind !== "pick") break;
          confirmPick(state, forced.slots);
          continue;
        }
        discardSlot(state, move.slots[0]);
        continue;
      }
      confirmPick(state, move.slots);
    }
  }
  return { name, decisions, wrong, cost, worst };
}

const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) || 100);
const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").slice(7));
const window = Number((argv.find((a) => a.startsWith("--window=")) || "--window=13").slice(9));
const only = (argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const names = only ? only.split(",") : Object.keys(CONFIGS);

console.log(`agreement with optimal play — ${games} games/config, seed ${seed}, judged where <= ${window} cards remain`);
console.log("");
console.log("config          judged   not optimal   avg cost when wrong   worst");
console.log("-".repeat(72));
for (const name of names) {
  const r = runConfig(name, games, seed, window);
  const rate = r.decisions ? (r.wrong / r.decisions * 100).toFixed(1) + "%" : "—";
  const avg = r.wrong ? (r.cost / r.wrong).toFixed(3) : "0";
  console.log(
    name.padEnd(14) +
    String(r.decisions).padStart(7) +
    rate.padStart(14) +
    avg.padStart(22) +
    r.worst.toFixed(3).padStart(8),
  );
}
console.log("");
console.log("cost is in pSilver + 2*pGold, the currency endgame.js ranks by:");
console.log("0.1 = a tenth of a silver chest given away on that one move.");
