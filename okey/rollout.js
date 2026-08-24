// Policy rollout with a chest objective.
//
// Everything up to v2 maximises expected points. Chests are thresholds: at 250
// with one round left, +30 points is worth nothing (still bronze) while at 280
// the same +30 is the whole game. The only way to price that correctly is to
// ask, for each candidate move, "how often does this end in silver/gold?"
//
// Method (Tesauro & Galperin policy rollout): apply the candidate move, then
// let the v2 heuristic play the rest against a randomly ordered deck, N times.
// Rank candidates by P(>=silver), tie-broken by P(>=gold), then mean score.
//
// Variance reduction: all candidates are evaluated against the SAME N deck
// orders (common random numbers), so the comparison between them is paired and
// N can stay small enough for the browser.

import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, CHEST_THRESHOLDS,
} from "./game.js";
import { suggestMove, rankCombos } from "./solver.js";
import { makeAvailableSet, bestAchievable } from "./potential.js";
import { EndgameSolver, maskOf } from "./endgame.js";

// N and the leaf cutoff compete for the same time budget, and the overnight
// search (bench/overnight.mjs, 5000 games per config) settled the trade:
// spending the time on more rollouts beats spending it on exact leaf
// evaluation. N=24 with the leaf off reaches 66.2% silver-or-better against
// 63.1% for N=16 with leaf=8, at ~180 ms per search.
//
// That search no longer sits in the click path either (see main.js): the
// instant heuristic answer is rendered first and this one replaces it right
// after, so the cost is off the critical path.
const DEFAULT_N = 24;

// Where a rollout stops guessing and starts knowing. Below this many cards in
// play the exact solver evaluates the position outright, so a playout no
// longer has to be finished by the v2 heuristic — which only reaches ~46%
// silver on its own and therefore colours every estimate it produces.
//
// A second benefit is variance: an exact leaf returns a PROBABILITY (0.62),
// not a coin flip (0 or 1), so the same N of playouts carries far more
// information.
// Off. A 120-game A/B once favoured leaf=8, but the overnight search varied it
// TOGETHER with N over 5000 games each and the advantage disappeared: at equal
// N the leaf variants land on the same numbers as leaf=0, and the time it
// costs buys more silver when spent on rollouts instead. A good example of why
// knobs tuned one at a time mislead. Kept switchable for future measurement.
const DEFAULT_EXACT_LEAF = 0;
const MAX_PICK_CANDIDATES = 3;

// What "best" means. Chests are worth different amounts to the player, and
// that changes the play: chasing gold means passing up safe silver.
//   "silver"   lexicographic P(silver) -> P(gold) -> mean  (safest chest)
//   "balanced" maximise P(silver) + 2 * P(gold)            (gold counts triple,
//                                                          since gold implies
//                                                          silver)
//   "gold"     lexicographic P(gold) -> P(silver) -> mean  (gold hunting)
// //   "points"   plain expected score (for comparison)
//   "auto"     what the helper actually ships with: hunt gold while gold is
//              still on, fall back to locking in silver once it is not. No
//              setting for the player to get wrong.
const OBJECTIVES = {
  silver: (s) => [s.pSilver, s.pGold, s.mean],
  balanced: (s) => [s.pSilver + 2 * s.pGold, s.mean],
  gold: (s) => [s.pGold, s.pSilver, s.mean],
  points: (s) => [s.mean],
};

// "Gold is still on" has two readings, and they play very differently:
//
//   feasible — arithmetically still possible (score + best remaining >= 400).
//              Stays true almost to the end, so this hunts gold all game.
//   likely   — some candidate move still reaches gold in at least
//              AUTO_GOLD_MIN of its rollouts. Gives up on gold earlier and
//              banks silver instead.
//
// Both are measured in bench/benchmark.mjs; the default is set from that.
export const AUTO_GOLD_MIN = 0.10;

function autoWantsGold(state, all, mode) {
  if (mode === "feasible") {
    const deck = deckRemaining(state);
    let filled = 0;
    for (const c of state.board) if (c) filled++;
    const rounds = Math.floor((deck.length + filled) / 3);
    const ceiling = bestAchievable(makeAvailableSet(deck, state.board), rounds);
    return state.score + ceiling >= CHEST_THRESHOLDS.gold;
  }
  for (const entry of all) if (entry.stats.pGold >= AUTO_GOLD_MIN) return true;
  return false;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneState(state) {
  return {
    board: [...state.board],
    score: state.score,
    consumed: new Set(state.consumed),
    history: [],
    log: [],
  };
}

// Candidate moves: every scoring pick plus every single discard. Non-scoring
// picks are never worth considering while a discard is possible.
function candidates(state) {
  const out = [];
  let picks = 0;
  for (const combo of rankCombos(state.board)) {
    // rankCombos is sorted by score; the 4th-best hand on a 5-card board is
    // never the right pick, and each extra candidate costs N playouts.
    if (combo.score > 0 && picks++ < MAX_PICK_CANDIDATES) {
      out.push({ kind: "pick", slots: combo.slots, cards: combo.cards, combo });
    }
  }
  if (deckRemaining(state).length > 0) {
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i]) out.push({ kind: "discard", slots: [i], cards: [state.board[i]] });
    }
  }
  return out;
}

function applyMove(state, move) {
  if (move.kind === "pick") confirmPick(state, move.slots);
  else discardSlot(state, move.slots[0]);
}

// Play forward with the base policy until the position is small enough to
// evaluate exactly, then hand it to the solver. Returns chest probabilities
// and an expected final score.
//
// E[score] comes out of the value curve for free: for a non-negative variable
// on a 10-point grid, E[X] = 10 * sum over t>=1 of P(X >= t).
function playout(state, rand, baseOptions, ctx) {
  let safety = 60;
  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    const filled = filledCards(state);
    if (filled.length < 3) break;

    const deck = deckRemaining(state);
    if (ctx && ctx.solver && deck.length + filled.length <= ctx.exactLeaf) {
      const curve = ctx.solver.value(maskOf([...deck, ...filled]), maskOf(filled));
      const at = (need) => {
        const i = Math.ceil(Math.max(0, need) / 10);
        return i <= 0 ? 1 : (i < curve.length ? curve[i] : 0);
      };
      let ev = 0;
      for (let t = 1; t < curve.length; t++) ev += curve[t] * 10;
      return {
        pSilver: at(CHEST_THRESHOLDS.silver - state.score),
        pGold: at(CHEST_THRESHOLDS.gold - state.score),
        mean: state.score + ev,
      };
    }

    const move = suggestMove(state, baseOptions);
    if (!move) break;
    if (move.kind === "discard") {
      if (deck.length === 0) break;
      discardSlot(state, move.slots[0]);
    } else {
      confirmPick(state, move.slots);
    }
  }
  return {
    pSilver: state.score >= CHEST_THRESHOLDS.silver ? 1 : 0,
    pGold: state.score >= CHEST_THRESHOLDS.gold ? 1 : 0,
    mean: state.score,
  };
}

export function suggestMoveRollout(state, options = {}) {
  const N = options.N ?? DEFAULT_N;
  const baseOptions = options.base ?? {};
  const moves = candidates(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return decorate(state, moves[0], null);

  // Common random numbers: one fixed seed per playout index, reused by every
  // candidate, so differences between candidates are not draw luck.
  const seeds = [];
  for (let i = 0; i < N; i++) seeds.push((options.seed ?? 0x9E3779B9) + i * 0x85EBCA6B);

  const objective = options.objective ?? "auto";

  // One exact-solver table for the whole decision: the leaf positions of every
  // playout are sub-positions of the same card set, so they share heavily and
  // only the first few cost anything.
  const exactLeaf = options.exactLeaf ?? DEFAULT_EXACT_LEAF;
  let ctx = null;
  if (exactLeaf > 0) {
    const solver = new EndgameSolver({ nodeLimit: options.leafNodeLimit ?? 2e6 });
    solver.prepare(maskOf([...deckRemaining(state), ...state.board.filter(Boolean)]));
    ctx = { solver, exactLeaf };
  }

  const all = [];
  for (const move of moves) {
    let silver = 0, gold = 0, sum = 0;
    for (const seed of seeds) {
      const s = cloneState(state);
      applyMove(s, move);
      const r = playout(s, makeRng(seed), baseOptions, ctx);
      silver += r.pSilver;
      gold += r.pGold;
      sum += r.mean;
    }
    const stats = { pSilver: silver / N, pGold: gold / N, mean: sum / N };
    all.push({ move, stats });
  }

  // "auto" decides the target from the position itself, then ranks with it.
  const rank = objective === "auto"
    ? (autoWantsGold(state, all, options.autoMode ?? "likely") ? OBJECTIVES.gold : OBJECTIVES.silver)
    : (OBJECTIVES[objective] ?? OBJECTIVES.silver);

  let best = null;
  for (const entry of all) {
    if (!best || better(rank(entry.stats), rank(best.stats))) best = entry;
  }
  return decorate(state, best.move, best.stats, all, N);
}

// Lexicographic comparison of the objective key vectors.
function better(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] > b[i];
  }
  return false;
}

function decorate(state, move, stats, all, N) {
  const pct = (x) => Math.round(x * 100) + "%";
  const tail = stats
    ? ` P(silver)=${pct(stats.pSilver)} · P(gold)=${pct(stats.pGold)} · E[final]≈${Math.round(stats.mean)} (${N} rollouts)`
    : "";
  if (move.kind === "pick") {
    const c = move.combo;
    return {
      kind: "pick", slots: move.slots, cards: move.cards, score: c.score,
      type: c.type, label: c.label,
      reasoning: `Pick ${c.label} for ${c.score} pts.${tail}`,
      rollout: { stats, all },
    };
  }
  return {
    kind: "discard", slots: move.slots, cards: move.cards,
    expectedAfter: stats ? stats.mean : 0,
    reasoning: `Discard ${move.cards[0]}.${tail}`,
    rollout: { stats, all },
  };
}
