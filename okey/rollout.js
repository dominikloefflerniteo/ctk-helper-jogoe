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

// Playouts per candidate.
//
// Was 24, and that number was a latency budget rather than a quality finding:
// the search used to run inside the click handler, so it could not cost more.
// It no longer runs there at all — it runs in a worker thread (search-worker.js)
// — and the 2026-09-09 overnight campaign measured what the extra playouts are
// worth on fresh seeds, against the same decks:
//
//   N=24 (was shipping)   64.4% silver-or-better, 6.0% gold
//   N=64 + halving        69.4%                   6.8%
//   N=96 + halving        70.6%                   7.3%
//
// Both chests improve together, which is what makes this different from the
// noise-band attempt of the day before: that one bought silver by giving up
// gold and was rolled back for it. The gain is monotone in N up to here, and
// N=96 is where the curve is flat enough that another doubling is not worth
// the memory churn.
//
// Cost, measured single-process: ~146 ms per decision (p90 299 ms, worst 415 ms)
// against ~41 ms before — all of it in the worker, none of it in front of a
// click. The instant heuristic answer is still what paints first.
// 2026-09-16: raised 96 -> 160 after the scoring/deck optimisations made it
// CHEAPER than the old 96. Measured on an idle machine, p90 per decision:
//
//   old code, N=96    311 ms   <- what shipped until today
//   new code, N=160   280 ms   <- what ships now
//   new code, N=240   360 ms   <- better rate still, but above the old lag
//
// Rate on fresh seeds 2-4, 6000 games: silver+ 70.6% -> 71.6%, gold 7.5% ->
// 8.0%. Neither difference is individually significant (z = 1.13 / 0.96); what
// carries it is that the gain is monotone in N across 96/160/240 and the sign
// is the same on all three seeds. N=240 is the better player and is left on the
// table deliberately: it costs more lag than the config it replaces.
const DEFAULT_N = 160;

// Options for the heuristic that finishes each playout. Contributed by Flavius
// (flaviusrzv/metin2-okey-helper) and measured here, not adopted on faith:
// type-aware pick damage, residual synergy, lambda 10.
//
// NB this is the PLAYOUT heuristic only. The instant provisional answer the UI
// paints first still runs plain v2 (lambda 6) — that is exactly the combination
// the benchmark measured, so it is exactly the combination that ships.
//
// Worth knowing before tuning further: at N=96 this heuristic is worth nothing
// measurable (+0.22pp silver+, z=0.26). It only starts paying once there are
// enough playouts to carry it, which is why it must never be tuned at low N.
const DEFAULT_BASE = { lambda: 10, typeAware: true, residualWeight: 1.0 };

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
//
// Each objective is the list of keys to rank by, in order, most important
// first. "balanced" ranks on a derived key (pSilver + 2 * pGold) computed per
// playout, so it goes through the same machinery as the rest.
const OBJECTIVES = {
  silver: ["pSilver", "pGold", "mean"],
  balanced: ["balanced", "mean"],
  gold: ["pGold", "pSilver", "mean"],
  points: ["mean"],
};

// Noise band on the ranking keys, in standard errors of the PAIRED difference
// between two candidates (the playouts share deck orders, so the pairing is
// valid). A candidate that is not separated from the leader by more than the
// band stays in the running and is decided by the next key.
//
// OFF BY DEFAULT, and that is deliberate: with the band on every key, a
// 2026-09-08 A/B over 800 paired games moved silver-or-better from 65.8% to
// 68.9% but gold from 6.5% down to 5.4%. Losing gold is the wrong trade to make
// silently — gold is what the player is actually playing for once it is in
// reach — so the band ships off until a setting is measured that keeps both.
//
// Per-key values are allowed: { pSilver: 1, pGold: 0 } bands the safety key but
// never the gold key, which is the variant under test. A plain number applies
// to every key.
const DEFAULT_TIE_Z = 0;

function tieZFor(tieZ, key) {
  if (tieZ == null) return 0;
  if (typeof tieZ === "number") return tieZ;
  return tieZ[key] ?? 0;
}

// How the playout budget is spread over the candidate moves.
//
//   "flat"    every candidate gets N playouts. Simple, and what has always
//             shipped — but on a five-card field with a full deck there are
//             usually 6-8 candidates, and most of them are not close: throwing
//             the one card that carries the whole run scores 0% in every
//             playout, and it costs exactly as much to establish that as it
//             costs to separate the two moves that are actually competing.
//   "halving" sequential halving. Same total playouts, spent in rounds: every
//             survivor is measured, the worse half is dropped, the budget moves
//             to the rest. The two real candidates end up with several times
//             the playouts they get now, at identical cost.
//
// "halving" ships: same total playouts, spent in rounds so the candidates that
// are actually competing get several times the resolution. Worth +0.7pp silver
// over flat at N=96 and slightly FASTER (146 ms vs 152 ms), because candidates
// that are settled stop being paid for.
//
// It needs the budget to be worth having: at N=24 halving measured WORSE than
// flat (62.1% against 65.2%) — splitting a small budget into rounds leaves too
// few playouts per round to drop the right half. Do not enable it without N.
const DEFAULT_ALLOCATE = "halving";

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

function autoWantsGold(state, all, mode, goldMin = AUTO_GOLD_MIN) {
  if (mode === "feasible") {
    const deck = deckRemaining(state);
    let filled = 0;
    for (const c of state.board) if (c) filled++;
    const rounds = Math.floor((deck.length + filled) / 3);
    const ceiling = bestAchievable(makeAvailableSet(deck, state.board), rounds);
    return state.score + ceiling >= CHEST_THRESHOLDS.gold;
  }
  for (const entry of all) if (entry.stats.pGold >= goldMin) return true;
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
  const baseOptions = options.base ?? DEFAULT_BASE;
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

  // Total playouts to spend on this decision. Both allocation strategies get
  // the same budget, so "halving" is free: it only moves playouts from
  // candidates that are already settled onto the ones still competing.
  const budget = N * moves.length;
  const allocate = options.allocate ?? DEFAULT_ALLOCATE;

  // Per-playout results are kept, not only their averages: the band compares
  // candidates playout by playout, which is only meaningful because they share
  // deck orders. Capacity is the whole budget because under halving a single
  // survivor can end up with far more than N.
  const all = moves.map((move) => ({
    move,
    n: 0,
    sums: { pSilver: 0, pGold: 0, mean: 0 },
    samples: {
      pSilver: new Float64Array(budget),
      pGold: new Float64Array(budget),
      mean: new Float64Array(budget),
      balanced: new Float64Array(budget),
    },
    stats: null,
  }));

  // Playout i of every candidate uses seed i — that is what makes the
  // comparison paired, and it holds under halving too: two candidates with
  // different counts still share the whole shorter prefix.
  const seedAt = (i) => (options.seed ?? 0x9E3779B9) + i * 0x85EBCA6B;

  const extend = (entry, upTo) => {
    for (let i = entry.n; i < upTo; i++) {
      const s = cloneState(state);
      applyMove(s, entry.move);
      const r = playout(s, makeRng(seedAt(i)), baseOptions, ctx);
      entry.samples.pSilver[i] = r.pSilver;
      entry.samples.pGold[i] = r.pGold;
      entry.samples.mean[i] = r.mean;
      entry.samples.balanced[i] = r.pSilver + 2 * r.pGold;
      entry.sums.pSilver += r.pSilver;
      entry.sums.pGold += r.pGold;
      entry.sums.mean += r.mean;
    }
    entry.n = Math.max(entry.n, upTo);
    entry.stats = {
      pSilver: entry.sums.pSilver / entry.n,
      pGold: entry.sums.pGold / entry.n,
      mean: entry.sums.mean / entry.n,
      balanced: (entry.sums.pSilver + 2 * entry.sums.pGold) / entry.n,
    };
  };

  // The objective needs stats to decide (autoWantsGold reads every candidate's
  // gold rate), so under halving it is fixed after the first round and kept —
  // switching objectives mid-search would compare arms measured under different
  // targets.
  let keys = null;
  const chooseKeys = () => {
    if (keys) return keys;
    keys = objective === "auto"
      ? (autoWantsGold(state, all, options.autoMode ?? "likely", options.goldMin ?? AUTO_GOLD_MIN)
          ? OBJECTIVES.gold : OBJECTIVES.silver)
      : (OBJECTIVES[objective] ?? OBJECTIVES.silver);
    return keys;
  };

  let pool = all;
  if (allocate === "halving" && moves.length > 2) {
    const rounds = Math.ceil(Math.log2(moves.length));
    let spent = 0;
    for (let r = 0; r < rounds && pool.length > 1; r++) {
      // What is left, split evenly over the rounds that remain.
      const perArm = Math.max(1, Math.floor((budget - spent) / ((rounds - r) * pool.length)));
      for (const e of pool) {
        const before = e.n;
        extend(e, e.n + perArm);
        spent += e.n - before;
      }
      chooseKeys();
      // Drop the worse half on the primary key alone — that is the point of the
      // method: a cheap, noisy verdict is enough to stop paying for a candidate
      // that is not in the running.
      const key = keys[0];
      const sorted = [...pool].sort((a, b) => b.stats[key] - a.stats[key]);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    }
    // Anything the rounds left unspent goes to the finalists.
    if (pool.length > 1 && spent < budget) {
      const perArm = Math.floor((budget - spent) / pool.length);
      if (perArm > 0) for (const e of pool) extend(e, e.n + perArm);
    }
  } else {
    for (const e of all) extend(e, N);
  }

  const best = pickBest(pool, chooseKeys(), options.tieZ ?? DEFAULT_TIE_Z);
  // `all` still carries every candidate, including the ones dropped early —
  // their stats are simply based on fewer playouts.
  return decorate(state, best.move, best.stats, all, N);
}

// Rank by the objective's keys in order, keeping whatever a key cannot
// separate for the next key to decide.
//
// With every band at 0 this is plain lexicographic ranking with a 1e-9
// tolerance — the same answer the old comparison gave, candidate order breaking
// a perfect tie — so the switch is genuinely off when it is off.
function pickBest(all, keys, tieZ) {
  let pool = all;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    let lead = pool[0];
    for (const e of pool) if (e.stats[key] > lead.stats[key] + 1e-9) lead = e;
    // The last key decides outright — there is nothing left to defer to.
    if (k === keys.length - 1 || pool.length === 1) return lead;
    const z = tieZFor(tieZ, key);
    const next = pool.filter((e) => e === lead || tied(lead, e, key, z));
    if (next.length === 1) return next[0];
    pool = next;
  }
  return pool[0];
}

// Is the gap between two candidates on this key smaller than the noise in the
// estimate of that gap?
//
// Paired, because both candidates played the same deck orders: the per-playout
// difference is what carries the signal, and its spread is far smaller than the
// spread of either candidate on its own.
function tied(lead, other, key, z) {
  const gap = lead.stats[key] - other.stats[key];
  if (z <= 0) return gap <= 1e-9;
  if (gap <= 1e-9) return true;
  // Under halving the two candidates may have different playout counts; the
  // shared prefix is the part that is actually paired, so the test uses that
  // and nothing else.
  const n = Math.min(lead.n, other.n);
  if (n < 2) return false;
  const a = lead.samples[key], b = other.samples[key];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] - b[i];
  const meanDiff = sum / n;
  if (meanDiff <= 1e-9) return true;
  let sq = 0;
  for (let i = 0; i < n; i++) { const d = (a[i] - b[i]) - meanDiff; sq += d * d; }
  const se = Math.sqrt(sq / (n - 1) / n);
  return meanDiff <= z * se;
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
