// Where are the runs actually lost — early or late?
//
// ceiling.mjs says silver is reachable in EVERY deck (minimum over 200 games is
// exactly 300), so a bronze run is always a play error somewhere. It does not
// say where, and that decides what is worth improving: the rollout that plays
// the first two thirds, or the exact endgame that closes it.
//
// The measurement point is the moment the position first becomes small enough
// to solve outright. There the exact solver states P(silver) under optimal play
// from here on — a clean divider:
//
//   entering already lost   P(silver) < 5%   the rollout phase gave it away;
//                                            no endgame work can recover these
//   entering already won    P(silver) > 95%  the run is decided; losing one of
//                                            these is an endgame error
//   entering live                            genuinely undecided, and the
//                                            conversion rate here is what the
//                                            endgame is worth
//
// Usage: node bench/where-lost.mjs [games] [--seed=1] [--window=13]

import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, chestForScore, CHEST_THRESHOLDS,
} from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";
import { suggestMove } from "../solver.js";
import { EndgameSolver, maskOf } from "../endgame.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// P(silver) and P(gold) from here on under optimal play, straight off the value
// curve. Own solver instance so the config's cache cannot colour it.
function exactOdds(state, window) {
  const deck = deckRemaining(state);
  const board = state.board.filter(Boolean);
  if (deck.length + board.length > window) return null;
  const available = maskOf([...deck, ...board]);
  const solver = new EndgameSolver({ nodeLimit: 5e6 });
  let curve;
  try {
    solver.prepare(available);
    curve = solver.value(available, maskOf(board));
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  const at = (need) => {
    const i = Math.ceil(Math.max(0, need) / 10);
    return i <= 0 ? 1 : (i < curve.length ? curve[i] : 0);
  };
  return {
    pSilver: at(CHEST_THRESHOLDS.silver - state.score),
    pGold: at(CHEST_THRESHOLDS.gold - state.score),
    score: state.score,
  };
}

const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) || 200);
const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").slice(7));
const window = Number((argv.find((a) => a.startsWith("--window=")) || "--window=13").slice(9));

const rand = makeRng(seed);
const rows = [];

for (let g = 0; g < games; g++) {
  const state = createState();
  const cache = createPolicyCache();
  let entry = null;
  let safety = 60;

  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;

    if (!entry) entry = exactOdds(state, window);

    const move = suggest(state, { cache });
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
  rows.push({ entry, final: state.score, chest: chestForScore(state.score) });
}

const withEntry = rows.filter((r) => r.entry);
const silver = (r) => r.chest === "silver" || r.chest === "gold";
const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + "%" : "—");

const lost = withEntry.filter((r) => r.entry.pSilver < 0.05);
const won = withEntry.filter((r) => r.entry.pSilver > 0.95);
const live = withEntry.filter((r) => r.entry.pSilver >= 0.05 && r.entry.pSilver <= 0.95);

console.log(`where the runs are decided — ${games} games, seed ${seed}, exact from ${window} cards`);
console.log("");
console.log(`games reaching the exact phase: ${withEntry.length} of ${games}`);
console.log(`overall silver-or-better:       ${pct(rows.filter(silver).length, rows.length)}`);
console.log("");
console.log("state on entering the exact phase        games        ended silver+");
console.log("-".repeat(70));
console.log(`already lost   (P(silver) < 5%)   ${String(lost.length).padStart(10)}   ${pct(lost.filter(silver).length, lost.length).padStart(18)}`);
console.log(`still live     (5-95%)            ${String(live.length).padStart(10)}   ${pct(live.filter(silver).length, live.length).padStart(18)}`);
console.log(`already won    (P(silver) > 95%)  ${String(won.length).padStart(10)}   ${pct(won.filter(silver).length, won.length).padStart(18)}`);
console.log("");

// What does a dead arrival look like? Two very different failures produce it,
// and they call for opposite fixes:
//
//   too few points  — the run banked little and arrives with no time left. The
//                     middle game discarded too much, chasing combos it never
//                     completed.
//   no material     — points are respectable but the cards left cannot pay the
//                     rest. The middle game spent the wrong cards.
//
// The score on arrival separates them: silver needs 300, and at 13 cards left
// there are at most 4 picks to come.
const avgOf = (rows, f) => (rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : 0);
console.log("score on entering the exact phase (silver needs 300):");
console.log(`  already lost   avg ${avgOf(lost, (r) => r.entry.score).toFixed(0)}` +
  `   min ${Math.min(...lost.map((r) => r.entry.score), Infinity)}` +
  `   max ${Math.max(...lost.map((r) => r.entry.score), -Infinity)}`);
console.log(`  still live     avg ${avgOf(live, (r) => r.entry.score).toFixed(0)}`);
console.log(`  already won    avg ${avgOf(won, (r) => r.entry.score).toFixed(0)}`);
console.log("");
// A dead arrival that is already close to 300 was a material failure; one far
// short never had the points in the first place.
const closeButDead = lost.filter((r) => r.entry.score >= 200).length;
console.log(`of the dead arrivals, ${closeButDead} of ${lost.length} were at 200+ already —` +
  ` those are spent-the-wrong-cards, not played-too-slowly.`);
console.log("");

const avgLive = live.length
  ? live.reduce((s, r) => s + r.entry.pSilver, 0) / live.length
  : 0;
console.log(`Reading it: every run in the first line was given away BEFORE the endgame —`);
console.log(`that share is the ceiling on what any endgame work can be worth. Any run in`);
console.log(`the last line that did not end silver is an endgame error. The middle line`);
console.log(`is the only place skill is still being applied: the solver rated those`);
console.log(`${(avgLive * 100).toFixed(1)}% on average and they converted at`);
console.log(`${pct(live.filter(silver).length, live.length)}.`);
