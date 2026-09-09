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
  // What ships (and what is deployed): exact from 12 cards down, no band.
  before: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0 },
  // The band on every ranking key. Reverted on 2026-09-08: it won silver and
  // gave up gold, and gold is what the player is playing for once it is close.
  bandAll: { exactMaxCards: 12, exactLeaf: 0, tieZ: 1.0 },
  // The variant under test: band the safety key, never the gold key. If the
  // gold loss came from treating a real gold edge as noise, this keeps the
  // silver gain without it.
  bandSilver: { exactMaxCards: 12, exactLeaf: 0, tieZ: { pSilver: 1.0, balanced: 1.0, pGold: 0 } },
  // Same, plus the wider exact window.
  bandSilver13: { exactMaxCards: 13, exactLeaf: 0, tieZ: { pSilver: 1.0, balanced: 1.0, pGold: 0 } },
  // Exact window alone, no band at all — the correctness fix on its own.
  exact13: { exactMaxCards: 13, exactLeaf: 0, tieZ: 0 },

  // ---- 2026-09-08 evening: where-lost.mjs showed the endgame is already
  // perfect (142/142 won positions converted, live ones at the solver's own
  // rate) and every loss happens before 13 cards remain. So these all aim at
  // the rollout phase, nothing else.

  // N was set to 24 when the search still blocked the click. It does not any
  // more, so the only cost of more playouts is a moment of staleness.
  n48: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, N: 48 },
  n64: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, N: 64 },
  // One objective, no threshold constant: rank everything by the currency the
  // exact solver already uses. Removes the hard switch at AUTO_GOLD_MIN, where
  // a 10% estimated gold chance flips the whole ranking.
  balanced: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, objective: "balanced" },
  // Hunt gold as long as it is arithmetically possible, instead of giving up
  // once no candidate reaches it in 10% of playouts.
  feasible: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, autoMode: "feasible" },
  // Same total playouts, spent where the decision is close instead of evenly
  // over candidates that are already settled.
  halving: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, allocate: "halving" },
  // A playout tail that knows what a chest needs. v2 maximises points and never
  // reads the score, so every playout misplays the close in the same direction.
  tail2: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, base: { thresholdTail: 2 } },
  tail3: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, base: { thresholdTail: 3 } },
  tail5: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, base: { thresholdTail: 5 } },
  // The two independent ideas together.
  halvingTail3: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, allocate: "halving", base: { thresholdTail: 3 } },
  // Winner of the 2026-09-09 overnight campaign, here for a properly PAIRED
  // confirmation: the campaign compared unequal sample sizes because the
  // deadline cut seed 4 short, and a +6.2pp claim should not rest on that.
  n96halving: { exactMaxCards: 12, exactLeaf: 0, tieZ: 0, N: 96, allocate: "halving" },
  // Same, plus the exact window that fixes the position this whole thread
  // started from. Costs ~8 ms per decision and no measurable rate.
  candidate: { exactMaxCards: 13, exactLeaf: 0, tieZ: 0, N: 96, allocate: "halving" },
};


const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) || 300);
// One seed, or several: --seeds=2,3,4,5 pools fresh seeds so a winner cannot
// simply suit the one shuffle sequence it was chosen on. Every config walks the
// seeds in the same order, so the dumps stay paired line for line.
const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").slice(7));
const seeds = (argv.find((a) => a.startsWith("--seeds=")) || "").slice(8);
const seedList = seeds ? seeds.split(",").map(Number) : [seed];
const only = (argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const dump = (argv.find((a) => a.startsWith("--dump=")) || "").slice(7);
const NL = String.fromCharCode(10);
const names = only ? only.split(",") : Object.keys(CONFIGS);

console.log(`Okey A/B — ${games} games x ${seedList.length} seed(s) [${seedList.join(",")}] per config (same decks for every config)`);
console.log(`chests: gold >= ${CHEST_THRESHOLDS.gold}, silver >= ${CHEST_THRESHOLDS.silver}`);
console.log("");
console.log("config     silver+        gold      avg      ms/game");
console.log("-".repeat(58));

for (const name of names) {
  const opts = CONFIGS[name];
  let silver = 0, gold = 0, sum = 0;
  const rows = [];
  const t0 = Date.now();
  for (const sd of seedList) {
    const rand = makeRng(sd);
    for (let i = 0; i < games; i++) {
      const r = playOneGame(rand, opts);
      sum += r.score;
      if (r.chest === "gold") { gold++; silver++; } else if (r.chest === "silver") silver++;
      if (dump) rows.push(JSON.stringify({ i, seed: sd, config: name, score: r.score, chest: r.chest }));
    }
  }
  if (dump) fs.writeFileSync(dump, rows.join(NL) + NL);
  const total = games * seedList.length;
  const ms = (Date.now() - t0) / total;
  const s = silver / total;
  const err = 1.96 * Math.sqrt((s * (1 - s)) / total) * 100;
  console.log(
    name.padEnd(9) +
    ((s * 100).toFixed(1) + "%").padStart(8) + " +-" + err.toFixed(1).padStart(4) +
    ((gold / total * 100).toFixed(1) + "%").padStart(10) +
    (sum / total).toFixed(1).padStart(9) +
    ms.toFixed(0).padStart(11),
  );
}
console.log("");
