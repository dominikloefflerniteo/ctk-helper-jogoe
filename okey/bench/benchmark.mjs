// Offline benchmark: self-play N Okey games with the heuristic solver against
// random decks, report chest rates (gold/silver/bronze) + score distribution.
//
// Usage:
//   node bench/benchmark.mjs [games]              # default policy, 2000 games
//   node bench/benchmark.mjs 5000 --oc=3          # one opportunity-cost value
//   node bench/benchmark.mjs 2000 --sweep         # grid-search OC 0..12 + greedy
//   node bench/benchmark.mjs 2000 --seed=7        # reproducible deck order
//
// This is the yardstick for tuning solver.js: change a weight, re-run, compare
// gold/silver rates on the SAME seed. A regression here is a regression for
// the player.
//
// Game model (mirrors game.js): 24 unique cards (1..8 x R/B/Y), 5 face-up
// slots, each turn is either "pick 3 and score" or "discard 1 and redraw".
// Picked and discarded cards leave the deck for good, so a game is at most
// 8 picks (8 x 3 = 24 cards) and every 3 discards costs one whole round.

import {
  createState, confirmPick, discardSlot, setSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, chestForScore, CHEST_THRESHOLDS,
} from "../game.js";
import { suggestMove } from "../solver.js";
import { suggestMoveRollout } from "../rollout.js";
import { suggest, createPolicyCache } from "../policy.js";

// ---------- seeded RNG (mulberry32) so runs are reproducible ----------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- one game ----------
// `policy.opportunityCost === Infinity` means "never discard" (pure greedy).
function playOneGame(rand, policy) {
  const state = createState();
  // The exact solver keeps one table per game (see policy.js).
  const cache = policy.policy === "combo" ? createPolicyCache() : null;
  let picks = 0, discards = 0;
  let safety = 60; // 8 picks + at most ~24 discards; 60 is plenty

  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break; // no pick possible → game over

    const move = policy.policy === "combo"
      ? suggest(state, { ...policy, cache })
      : policy.policy === "rollout"
        ? suggestMoveRollout(state, policy)
        : suggestMove(state, policy);
    if (!move) break;

    if (move.kind === "discard") {
      // Guard: never discard the deck dry — with <1 card left a discard just
      // shrinks the board without a redraw.
      if (deckRemaining(state).length === 0) {
        const forced = suggestMove(state, { policy: "v1", opportunityCost: Infinity });
        if (!forced || forced.kind !== "pick") break;
        confirmPick(state, forced.slots);
        picks++;
        continue;
      }
      discardSlot(state, move.slots[0]);
      discards++;
      continue;
    }

    confirmPick(state, move.slots);
    picks++;
  }

  return { score: state.score, picks, discards, chest: chestForScore(state.score) };
}


// ---------- alternative rule model: "rounds" ----------
//
// Why this exists: under the model above (every discard permanently burns a
// card) a set can never be 8 full rounds AND use discards — 8 x 3 = 24 is the
// whole deck. Yet the UI states "8 rounds per set, 100 pts max per round" and
// puts gold at 400 of a possible 800, which only makes sense if discarding
// does NOT cost rounds. The likely real rule: a discarded card goes back into
// the deck (or the deck is refilled), and discards are capped by a per-set
// budget instead. Until we can watch the live event, this model brackets the
// other end: fixed 8 rounds, discarded cards return to the deck, `budget`
// discards for the whole set.
function playOneGameRounds(rand, policy) {
  const state = createState();
  const rounds = policy.rounds ?? 8;
  let budget = policy.budget ?? 0;
  let picks = 0, discards = 0;
  let safety = 200;

  while (picks < rounds && safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;

    const move = budget > 0
      ? suggestMove(state, policy)
      : suggestMove(state, { policy: "v1", opportunityCost: Infinity });
    if (!move) break;

    if (move.kind === "discard" && budget > 0) {
      // setSlot (not discardSlot) => the card is NOT consumed, so it returns
      // to the deck pool and can be drawn again later this set.
      setSlot(state, move.slots[0], null);
      budget--;
      discards++;
      continue;
    }
    if (move.kind !== "pick") break;
    confirmPick(state, move.slots);
    picks++;
  }
  return { score: state.score, picks, discards, chest: chestForScore(state.score) };
}

// ---------- stats ----------
function summarize(label, results) {
  const n = results.length;
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / n;
  const q = (p) => scores[Math.min(n - 1, Math.floor(p * n))];

  const chests = { gold: 0, silver: 0, bronze: 0 };
  let picks = 0, discards = 0;
  for (const r of results) { chests[r.chest]++; picks += r.picks; discards += r.discards; }

  return {
    label, n, mean, sd: Math.sqrt(variance),
    median: q(0.5), p10: q(0.10), p90: q(0.90), max: scores[n - 1], min: scores[0],
    pGold: chests.gold / n, pSilver: chests.silver / n, pBronze: chests.bronze / n,
    avgPicks: picks / n, avgDiscards: discards / n,
  };
}

// `policyOpts` is passed straight through to suggestMove (plus any extra
// model settings), so the bench can compare v1/v2 and sweep their knobs.
function runConfig(label, policyOpts, games, seed, extra = null) {
  const rand = makeRng(seed); // same seed per config → paired comparison
  const play = extra ? playOneGameRounds : playOneGame;
  const policy = { ...policyOpts, ...(extra || {}) };
  const results = [];
  for (let i = 0; i < games; i++) results.push(play(rand, policy));
  return summarize(label, results);
}

// ---------- output ----------
const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
const num = (x, d = 1) => x.toFixed(d).padStart(6);

function printTable(rows) {
  console.log("");
  console.log("policy        avg score     sd   median    p90    max   gold   silver   bronze   picks  disc");
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      r.label.padEnd(12) +
      num(r.mean) + "  " + num(r.sd) + "  " +
      String(r.median).padStart(6) + " " + String(r.p90).padStart(6) + " " + String(r.max).padStart(6) + "  " +
      pct(r.pGold) + "   " + pct(r.pSilver) + "   " + pct(r.pBronze) + "  " +
      num(r.avgPicks, 2) + " " + num(r.avgDiscards, 2)
    );
  }
  console.log("");
}

function printHistogram(label, policyOpts, games, seed) {
  const rand = makeRng(seed);
  const buckets = new Map();
  for (let i = 0; i < games; i++) {
    const { score } = playOneGame(rand, policyOpts);
    const b = Math.floor(score / 50) * 50;
    buckets.set(b, (buckets.get(b) || 0) + 1);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  console.log(`score distribution — ${label} (bucket = 50 pts)`);
  const maxCount = Math.max(...buckets.values());
  for (const k of keys) {
    const c = buckets.get(k);
    const bar = "#".repeat(Math.max(1, Math.round((c / maxCount) * 44)));
    const tier = k >= CHEST_THRESHOLDS.gold ? "GOLD  " : k >= CHEST_THRESHOLDS.silver ? "silver" : "      ";
    console.log(
      String(k).padStart(4) + "-" + String(k + 49).padStart(4) + " " + tier + " " +
      String(c).padStart(6) + " " + (c / games * 100).toFixed(1).padStart(5) + "%  " + bar
    );
  }
  console.log("");
}

// ---------- main ----------
const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) || 2000);
const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").slice(7));
const sweep = argv.includes("--sweep");
const ocArg = argv.find((a) => a.startsWith("--oc="));
const hist = argv.includes("--hist");

console.log(`Okey solver benchmark — ${games} games/config, seed ${seed}`);
console.log(`chests: gold >= ${CHEST_THRESHOLDS.gold}, silver >= ${CHEST_THRESHOLDS.silver}, else bronze`);

const roundsModel = argv.includes("--model=rounds");
const lambdaArg = argv.find((a) => a.startsWith("--lambda="));
const V1 = (oc) => ({ policy: "v1", opportunityCost: oc });
const V2 = (l) => ({ policy: "v2", lambda: l });
const V2NOEND = (l) => ({ policy: "v2", lambda: l, endgame: false });
const V2NOSYN = (l) => ({ policy: "v2", lambda: l, synergy: false });

if (roundsModel) {
  // Sweep the per-set discard budget under the "rounds" rule model.
  const pol = lambdaArg ? V2(Number(lambdaArg.slice(9))) : ocArg ? V1(Number(ocArg.slice(5))) : V2(undefined);
  console.log("model: 8 rounds/set, discarded cards return to the deck");
  const rows = [];
  for (const budget of [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 40]) {
    rows.push(runConfig(`budget=${budget}`, pol, games, seed, { budget, rounds: 8 }));
  }
  printTable(rows);
} else if (sweep) {
  // Grid-search whichever policy was asked for (default: v2's lambda).
  const rows = [
    runConfig("greedy", V1(Infinity), games, seed),
    runConfig("v1 OC=5", V1(5), games, seed),
  ];
  if (argv.includes("--v1")) {
    for (let oc = 0; oc <= 12; oc++) rows.push(runConfig(`v1 OC=${oc}`, V1(oc), games, seed));
  } else {
    rows.push(runConfig("v2 L=6", V2(6), games, seed));
    // Exact-leaf A/B: does ending each playout in the exact solver help, or
    // does the weak-head/perfect-tail mismatch bias the search?
    for (const leaf of [0, 8, 10]) {
      rows.push(runConfig(`leaf=${leaf}`,
        { policy: "rollout", N: 16, objective: "balanced", exactLeaf: leaf }, games, seed));
    }
  }
  printTable(rows);
  const best = rows.slice().sort((a, b) => (b.pGold + b.pSilver) - (a.pGold + a.pSilver))[0];
  console.log(`best by gold+silver rate: ${best.label} (${(best.pGold * 100).toFixed(1)}% gold, ${(best.pSilver * 100).toFixed(1)}% silver, avg ${best.mean.toFixed(1)})`);
  const bestMean = rows.slice().sort((a, b) => b.mean - a.mean)[0];
  console.log(`best by average score:    ${bestMean.label} (avg ${bestMean.mean.toFixed(1)})`);
} else if (argv.includes("--combo")) {
  // Head-to-head of what could ship.
  printTable([
    runConfig("v2 L=6", V2(6), games, seed),
    runConfig("roll balanced", { policy: "rollout", N: 24, objective: "balanced" }, games, seed),
    // No N / exactLeaf here on purpose: this must measure the values the
    // helper actually ships with (rollout.js defaults), not a bench-only mix.
    runConfig("combo (ship)", { policy: "combo", objective: "balanced" }, games, seed),
  ]);
} else {
  // Default: the two reference policies plus the current default.
  const rows = [
    runConfig("greedy", V1(Infinity), games, seed),
    runConfig("v1 OC=5", V1(5), games, seed),
  ];
  const pol = lambdaArg ? V2(Number(lambdaArg.slice(9))) : ocArg ? V1(Number(ocArg.slice(5))) : V2(undefined);
  const label = lambdaArg ? `v2 L=${lambdaArg.slice(9)}` : ocArg ? `v1 OC=${ocArg.slice(5)}` : "v2 (default)";
  rows.push(runConfig(label, pol, games, seed));
  printTable(rows);
  if (hist) printHistogram(label, pol, games, seed);
}
