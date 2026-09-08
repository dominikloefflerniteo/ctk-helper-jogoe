// A/B for the 2026-09-08 fix: exact window 12 -> 13, exact playout leaf back on,
// and a noise band on the rollout's ranking keys.
//
// Why a dedicated script instead of benchmark.mjs --combo: that one measures
// `objective: "balanced"`, which is not what the helper calls. The app calls
// suggest(state, { cache }) with no objective at all, i.e. "auto". This runs
// exactly that call and varies only the three knobs under test, so the numbers
// are about the change and nothing else.
//
// Every config plays the SAME decks (one seeded shuffle sequence per seed,
// replayed per config), so the comparison is paired and a few hundred games
// already separate configurations that a fresh shuffle each would not.
//
// Usage:
//   node bench/ab-tiebreak.mjs [games] [--seed=1] [--only=before,after]
//   node bench/ab-tiebreak.mjs 800 --only=after --dump=bench/after.jsonl
//
// --dump writes one line per game (score + chest). Two configs dumped on the
// same seed can then be compared PAIRED (bench/ab-paired.mjs), which is the
// only comparison the marginal +-x% in this table does not support: both
// configs played the same decks, so most of the spread is the deck, not the
// policy.

import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, chestForScore, CHEST_THRESHOLDS,
} from "../game.js";
import fs from "node:fs";
import { suggest, createPolicyCache } from "../policy.js";
import { suggestMove } from "../solver.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One game, played by the shipping entry point with `opts` layered on top.
function playOneGame(rand, opts) {
  const state = createState();
  const cache = createPolicyCache();
  let safety = 60;

  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;

    const move = suggest(state, { ...opts, cache });
    if (!move) break;

    if (move.kind === "discard") {
      // Never discard the deck dry: with no card to draw, a discard just
      // shrinks the field.
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
  return { score: state.score, chest: chestForScore(state.score) };
}

const CONFIGS = {
  // What shipped before the fix.
  before: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0 },
  // The three parts on their own, to see which one actually pays.
  exact13: { exactMaxCards: 13, exactLeaf: 0, tieZ: 0 },
  leaf: { exactMaxCards: 12, exactLeaf: 13, tieZ: 0 },
  band: { exactMaxCards: 12, exactLeaf: 0, tieZ: 1.0 },
  // What ships now (defaults; listed explicitly so the log records them).
  after: { exactMaxCards: 13, exactLeaf: 0, tieZ: 1.0 },
};

const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) || 300);
const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").slice(7));
const only = (argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const dump = (argv.find((a) => a.startsWith("--dump=")) || "").slice(7);
const NL = String.fromCharCode(10);
const names = only ? only.split(",") : Object.keys(CONFIGS);

console.log(`Okey A/B — ${games} games/config, seed ${seed} (same decks for every config)`);
console.log(`chests: gold >= ${CHEST_THRESHOLDS.gold}, silver >= ${CHEST_THRESHOLDS.silver}`);
console.log("");
console.log("config     silver+        gold      avg      ms/game");
console.log("-".repeat(58));

for (const name of names) {
  const opts = CONFIGS[name];
  const rand = makeRng(seed);
  let silver = 0, gold = 0, sum = 0;
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const r = playOneGame(rand, opts);
    sum += r.score;
    if (r.chest === "gold") { gold++; silver++; } else if (r.chest === "silver") silver++;
    if (dump) rows.push(JSON.stringify({ i, config: name, score: r.score, chest: r.chest }));
  }
  if (dump) fs.writeFileSync(dump, rows.join(NL) + NL);
  const ms = (Date.now() - t0) / games;
  const s = silver / games;
  const err = 1.96 * Math.sqrt((s * (1 - s)) / games) * 100;
  console.log(
    name.padEnd(9) +
    ((s * 100).toFixed(1) + "%").padStart(8) + " +-" + err.toFixed(1).padStart(4) +
    ((gold / games * 100).toFixed(1) + "%").padStart(10) +
    (sum / games).toFixed(1).padStart(9) +
    ms.toFixed(0).padStart(11),
  );
}
console.log("");
