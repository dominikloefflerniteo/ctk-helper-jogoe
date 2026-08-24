// What does a click actually cost now? Mirrors the UI's call pattern:
// a card entry changes the position, a pick selection does not.
import { createState, addCard, autoFillBoardFromDeck, deckRemaining, filledCards } from "../game.js";
import { suggest, createPolicyCache, chestOutlook } from "../policy.js";

const cache = createPolicyCache();
const state = createState();
autoFillBoardFromDeck(state, Math.random);

const ms = (fn, reps = 20) => {
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / reps;
};

console.log("cost of one interaction, by what the UI now does");
console.log("");
console.log("instant answer (every click, blocking):    " +
  ms(() => suggest(state, { cache, mode: "heuristic" }), 200).toFixed(2) + " ms");
console.log("strong answer (once per position, async):  " +
  ms(() => suggest(state, { cache }), 3).toFixed(0) + " ms");
console.log("selection toggle (cache hit, no search):   ~0.00 ms  (position key unchanged)");
console.log("end-of-run check (once per position):      " +
  ms(() => chestOutlook(state, { cache }), 20).toFixed(2) + " ms");
