// What does raising the playout budget cost the player?
//
// bench/latency.mjs times ONE fixed position, which understates the spread:
// the cost of a decision depends on how many candidate moves it has, and a
// full board with several scoring combos is far more expensive than the
// position it happens to sample. This walks real games and times every
// decision, so the p90 is a p90 over the positions a player actually meets.
//
// The number that matters is not the mean. The search runs in a worker and the
// instant heuristic answer paints first, so the player never blocks — what they
// see is how long the provisional answer stands before the strong one replaces
// it. That is a p90 question, not an average one.
//
//   node bench/latency-n.mjs [gamesPerConfig]

import { createState, confirmPick, discardSlot, autoFillBoardFromDeck,
         deckRemaining, filledCards } from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";
import { suggestMove } from "../solver.js";

const GAMES = Number(process.argv[2] || 12);

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

console.log(`latency per decision — ${GAMES} games/config, every decision timed`);
console.log("(the search runs in a worker; this is how long the provisional answer stands)\n");
console.log("config                    n     p50     p90     p99    worst    mean");
console.log("-".repeat(70));

for (const N of [96, 160, 240, 320]) {
  const rand = makeRng(1);          // same decks for every config
  const times = [];
  for (let g = 0; g < GAMES; g++) {
    const state = createState();
    const cache = createPolicyCache();
    let safety = 60;
    while (safety-- > 0) {
      autoFillBoardFromDeck(state, rand);
      if (filledCards(state).length < 3) break;
      const t0 = process.hrtime.bigint();
      const move = suggest(state, { policy: "combo", objective: "auto", N, cache });
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (!move) break;
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
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `N=${String(N).padEnd(4)}               ${String(times.length).padStart(5)}` +
    `${quantile(times, 0.5).toFixed(0).padStart(8)}` +
    `${quantile(times, 0.9).toFixed(0).padStart(8)}` +
    `${quantile(times, 0.99).toFixed(0).padStart(8)}` +
    `${times[times.length - 1].toFixed(0).padStart(9)}` +
    `${mean.toFixed(0).padStart(8)}`
  );
}
