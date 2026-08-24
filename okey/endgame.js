// Exact endgame solver.
//
// Once few cards are left, the position is small enough to solve outright
// instead of estimating it. The deck is perfect information as a SET — only
// the order is unknown — so the game is a finite MDP:
//
//   state   = (cards still in play A, the face-up cards B subset of A)
//   actions = pick any 3 of B (scores, those cards leave A), or discard 1 of B
//   chance  = replacements are drawn uniformly from A \ B
//
// Consumed cards never matter again, so they stay out of the state. That is
// what keeps this tractable: from a position with `a` cards left there are
// O(3^a) reachable (A, B) pairs, not O(2^24).
//
// Threshold objective, every threshold at once
// --------------------------------------------
// Chests are thresholds, so the value of a state is not a number but a curve:
// P(score at least 0 more), P(at least 10 more), P(at least 20 more), ...
// Every combo pays a multiple of 10, so that curve is a small array, and one
// pass answers silver, gold, and "we are 40 short with two rounds left" — the
// situation that actually decides chests.
//
//   value[t] = max over actions of E[ value_after[t - gained] ]
//
// The per-threshold max is legitimate: the player knows their score, so for
// each t this is a well-defined MDP and the best action may differ per t. That
// is the point — the same board is "bank it" at t=20 and "gamble" at t=90.

import { COLORS, VALUES, scoreHand, cardId } from "./game.js";

export const CARD_COUNT = 24;
const STEP = 10; // every combo pays a multiple of 10
export const GOLD_WEIGHT = 2;

// ---- card indexing: 0..23, index = colour * 8 + (value - 1) ----
export function cardIndex(id) {
  return COLORS.indexOf(id[0]) * 8 + (Number(id.slice(1)) - 1);
}
export function indexToCard(i) {
  return cardId(COLORS[Math.floor(i / 8)], (i % 8) + 1);
}
export function maskOf(cards) {
  let m = 0;
  for (const c of cards) if (c) m |= 1 << cardIndex(c);
  return m;
}
function bitsOf(mask) {
  const out = [];
  for (let i = 0; i < CARD_COUNT; i++) if (mask & (1 << i)) out.push(i);
  return out;
}
export function popcount(m) {
  let n = 0;
  while (m) { m &= m - 1; n++; }
  return n;
}

// ---- precomputed scores for all C(24,3) triples ----
const TRIPLE_SCORE = new Int16Array(CARD_COUNT * CARD_COUNT * CARD_COUNT);
(function buildScores() {
  for (let i = 0; i < CARD_COUNT; i++) {
    for (let j = i + 1; j < CARD_COUNT; j++) {
      for (let k = j + 1; k < CARD_COUNT; k++) {
        TRIPLE_SCORE[i * 576 + j * 24 + k] =
          scoreHand([indexToCard(i), indexToCard(j), indexToCard(k)]).score;
      }
    }
  }
})();
export function tripleScore(i, j, k) {
  const a = Math.min(i, j, k), c = Math.max(i, j, k);
  return TRIPLE_SCORE[a * 576 + (i + j + k - a - c) * 24 + c];
}

// All k-element subsets of `bits`, returned as bitmasks.
function subsetsOfSize(bits, k) {
  const out = [];
  const n = bits.length;
  if (k > n || k < 0) return out;
  if (k === 0) return [0];
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    let m = 0;
    for (let p = 0; p < k; p++) m |= 1 << bits[idx[p]];
    out.push(m);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}


// ---- colour symmetry (MEASURED, OFF BY DEFAULT) ----
//
// Red, blue and yellow are interchangeable, so a position and any recolouring
// of it have identical value. Folding the memo key onto a canonical colouring
// looks like a free 6x — and it is not.
//
// From a real position the set of cards in play is FIXED. Recolouring it
// produces a card set that never occurs anywhere in that search tree, so
// almost nothing collapses: measured 1.03x fewer states and ~10% slower from
// the extra work per lookup (bench/symmetry-check.mjs; results identical to
// the last digit). Symmetry would only pay off for a fully precomputed table
// over all positions, which is a different project.
//
// Kept, off by default, so the idea is not retried blind.
//
// Colour c owns bits c*8 .. c*8+7, so a permutation is just moving three bytes.
const COLOR_PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

function permuteMask(mask, perm) {
  let out = 0;
  for (let c = 0; c < 3; c++) out |= ((mask >> (c * 8)) & 0xFF) << (perm[c] * 8);
  return out;
}

// Largest (available, board) pair over all recolourings — a stable
// representative of the whole symmetry class.
export function canonicalKey(available, board) {
  let bestA = -1, bestB = -1;
  for (let p = 0; p < COLOR_PERMS.length; p++) {
    const a = permuteMask(available, COLOR_PERMS[p]);
    if (a < bestA) continue;
    const b = permuteMask(board, COLOR_PERMS[p]);
    if (a > bestA || b > bestB) { bestA = a; bestB = b; }
  }
  return bestA * 16777216 + bestB;
}

export class EndgameSolver {
  // nodeLimit guards against being handed a position that is still too big.
  constructor({ nodeLimit = 5e6, symmetry = false } = {}) {
    this.memo = new Map();
    this.symmetry = symmetry;
    this.nodeLimit = nodeLimit;
    this.nodes = 0;
    this.NT = 1;
  }

  // Value curve of a position. Throws RangeError past nodeLimit.
  // Sets the threshold grid from the root position and resets the table.
  solve(available, board) {
    this.prepare(available);
    return this.value(available, board);
  }

  // Set up the threshold grid without discarding the table — for playing a
  // position out move by move, where every later state is a sub-state of the
  // first and the memo stays valid.
  prepare(available) {
    this.NT = Math.floor(popcount(available) / 3) * 10 + 1;
    this.nodes = 0;
    this.memo.clear();
  }

  value(available, board) {
    const key = this.symmetry ? canonicalKey(available, board) : available * 16777216 + board;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    if (++this.nodes > this.nodeLimit) throw new RangeError("endgame node limit exceeded");

    const NT = this.NT;
    const vec = new Float32Array(NT);
    vec[0] = 1; // "at least 0 more points" is free

    const boardBits = bitsOf(board);
    const deckBits = bitsOf(available & ~board);
    const drawCount = Math.min(3, deckBits.length);

    // --- picks ---
    for (let x = 0; x + 2 < boardBits.length; x++) {
      for (let y = x + 1; y + 1 < boardBits.length; y++) {
        for (let z = y + 1; z < boardBits.length; z++) {
          const i = boardBits[x], j = boardBits[y], k = boardBits[z];
          const gained = tripleScore(i, j, k);
          if (gained === 0) continue; // burning 3 cards for nothing never helps
          const hand = (1 << i) | (1 << j) | (1 << k);
          const acc = this.chance(available & ~hand, board & ~hand, deckBits, drawCount);
          const shift = gained / STEP;
          for (let t = 0; t < NT; t++) {
            const src = t - shift;
            const p = src <= 0 ? 1 : (src < NT ? acc[src] : 0);
            if (p > vec[t]) vec[t] = p;
          }
        }
      }
    }

    // --- discards (pointless with an empty deck: no replacement arrives) ---
    if (deckBits.length > 0) {
      for (const c of boardBits) {
        const kept = board & ~(1 << c);
        const nextAvail = available & ~(1 << c);
        const acc = this.chance(nextAvail, kept, bitsOf(nextAvail & ~kept), 1);
        for (let t = 0; t < NT; t++) if (acc[t] > vec[t]) vec[t] = acc[t];
      }
    }

    this.memo.set(key, vec);
    return vec;
  }

  // Average the value over every equally likely set of replacement cards.
  chance(available, kept, deckBits, drawCount) {
    const NT = this.NT;
    const acc = new Float32Array(NT);
    const k = Math.min(drawCount, deckBits.length);
    if (k <= 0) {
      acc.set(this.value(available, kept));
      return acc;
    }
    const draws = subsetsOfSize(deckBits, k);
    for (const draw of draws) {
      const v = this.value(available, kept | draw);
      for (let t = 0; t < NT; t++) acc[t] += v[t];
    }
    for (let t = 0; t < NT; t++) acc[t] /= draws.length;
    return acc;
  }


  // Best move judged by both chests at once.
  //
  // The value curve already holds P(reach silver) and P(reach gold) for every
  // action, so there is nothing to configure: rank by
  //
  //     P(silver) + GOLD_WEIGHT * P(gold)
  //
  // and the requested behaviour falls out on its own. Once silver is banked,
  // needSilver <= 0 makes P(silver) = 1 for every move and the ranking
  // collapses to pure gold hunting. Once gold is out of reach, P(gold) = 0
  // everywhere and it collapses to locking in silver. In between it trades the
  // two at their real prices, with no threshold constant to tune.
  //
  // GOLD_WEIGHT = 2 (gold counts triple overall, since gold implies silver)
  // is the setting that won the objective benchmark.
  bestMoveChest(available, board, needSilver, needGold, keepMemo = false) {
    if (!keepMemo) this.solve(available, board);
    else this.value(available, board);
    const NT = this.NT;
    const at = (vec, need, shift) => {
      const src = Math.ceil(need / STEP) - shift;
      if (src <= 0) return 1;
      return src < NT ? vec[src] : 0;
    };

    const boardBits = bitsOf(board);
    const deckBits = bitsOf(available & ~board);
    const drawCount = Math.min(3, deckBits.length);

    // Expected points still to come, read straight off the value curve: for a
    // non-negative variable on a 10-point grid, E[X] = 10 * sum of P(X >= t).
    const expected = (vec) => {
      let e = 0;
      for (let t = 1; t < NT; t++) e += vec[t];
      return e * STEP;
    };

    let best = null;
    const consider = (stats) => {
      const rank = stats.pSilver + GOLD_WEIGHT * stats.pGold;
      // Points are the LAST word, never the first. Once the chest is settled
      // — silver locked and gold gone — every line has the same probabilities
      // and the solver would otherwise pick at random, throwing away a
      // 90-point hand for a 10-point one. It costs no chest to also be greedy
      // about points in that situation, and it looks far less broken.
      const betterRank = !best || rank > best.rank + 1e-9;
      const tiedRank = best && Math.abs(rank - best.rank) <= 1e-9;
      if (betterRank || (tiedRank && stats.expected > best.expected + 1e-6)) {
        best = { ...stats, rank };
      }
    };

    for (let x = 0; x + 2 < boardBits.length; x++) {
      for (let y = x + 1; y + 1 < boardBits.length; y++) {
        for (let z = y + 1; z < boardBits.length; z++) {
          const i = boardBits[x], j = boardBits[y], k = boardBits[z];
          const gained = tripleScore(i, j, k);
          if (gained === 0) continue;
          const hand = (1 << i) | (1 << j) | (1 << k);
          const acc = this.chance(available & ~hand, board & ~hand, deckBits, drawCount);
          const shift = gained / STEP;
          consider({
            kind: "pick", cards: [i, j, k].map(indexToCard), gained,
            pSilver: at(acc, needSilver, shift), pGold: at(acc, needGold, shift),
            expected: gained + expected(acc),
          });
        }
      }
    }
    if (deckBits.length > 0) {
      for (const c of boardBits) {
        const kept = board & ~(1 << c);
        const nextAvail = available & ~(1 << c);
        const acc = this.chance(nextAvail, kept, bitsOf(nextAvail & ~kept), 1);
        consider({
          kind: "discard", cards: [indexToCard(c)], gained: 0,
          pSilver: at(acc, needSilver, 0), pGold: at(acc, needGold, 0),
          expected: expected(acc),
        });
      }
    }
    return best;
  }

  // Best move for a concrete need (points still required for the target chest).
  // `keepMemo` reuses the existing table (see prepare()).
  bestMove(available, board, need, keepMemo = false) {
    if (!keepMemo) this.solve(available, board);
    else this.value(available, board);
    const NT = this.NT;
    const want = Math.max(0, Math.min(NT - 1, Math.ceil(need / STEP)));
    const boardBits = bitsOf(board);
    const deckBits = bitsOf(available & ~board);
    const drawCount = Math.min(3, deckBits.length);

    let best = null;
    for (let x = 0; x + 2 < boardBits.length; x++) {
      for (let y = x + 1; y + 1 < boardBits.length; y++) {
        for (let z = y + 1; z < boardBits.length; z++) {
          const i = boardBits[x], j = boardBits[y], k = boardBits[z];
          const gained = tripleScore(i, j, k);
          if (gained === 0) continue;
          const hand = (1 << i) | (1 << j) | (1 << k);
          const acc = this.chance(available & ~hand, board & ~hand, deckBits, drawCount);
          const src = want - gained / STEP;
          const p = src <= 0 ? 1 : (src < NT ? acc[src] : 0);
          if (!best || p > best.p) {
            best = { p, kind: "pick", cards: [i, j, k].map(indexToCard), gained };
          }
        }
      }
    }
    if (deckBits.length > 0) {
      for (const c of boardBits) {
        const kept = board & ~(1 << c);
        const nextAvail = available & ~(1 << c);
        const acc = this.chance(nextAvail, kept, bitsOf(nextAvail & ~kept), 1);
        if (!best || acc[want] > best.p) {
          best = { p: acc[want], kind: "discard", cards: [indexToCard(c)] };
        }
      }
    }
    return best;
  }
}
