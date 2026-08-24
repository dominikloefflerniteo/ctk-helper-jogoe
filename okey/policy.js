// The helper's single entry point: use the strongest method the position can
// afford.
//
//   <= EXACT_MAX_CARDS cards left  ->  exact solve (endgame.js). Optimal play,
//                                      no approximation, both chests priced
//                                      off the same value curve.
//   more than that                 ->  policy rollout (rollout.js) over the
//                                      v2 heuristic.
//
// The cutoff is a time budget, not a quality judgement. Exact solving costs
// ~2.8x per extra card still in play (measured in bench/endgame-timing.mjs):
// 12 cards is ~200 ms, 13 is ~630 ms, 16 is 22 s. Twelve keeps every
// suggestion under a fifth of a second.
//
// In a normal game (about 4 picks and 11 discards) the exact phase begins
// around the seventh action, so it covers every decision that actually settles
// which chest you end up with.

import { deckRemaining, CHEST_THRESHOLDS, scoreHand } from "./game.js";
import { EndgameSolver, maskOf } from "./endgame.js";
import { makeAvailableSet, bestAchievable } from "./potential.js";
import { suggestMoveRollout } from "./rollout.js";
import { suggestMove } from "./solver.js";

export const EXACT_MAX_CARDS = 12;

// Per-game scratchpad. The exact solver's table stays valid for the rest of a
// game — every later position is a sub-position of the first one solved — so
// reusing it makes the closing turns nearly free.
export function createPolicyCache() {
  return { solver: null };
}

function exactSuggestion(state, deck, cache) {
  const boardCards = state.board.filter(Boolean);
  const available = maskOf([...deck, ...boardCards]);
  const board = maskOf(boardCards);

  let solver = cache && cache.solver;
  if (!solver) {
    solver = new EndgameSolver();
    solver.prepare(available);
    if (cache) cache.solver = solver;
  }

  const best = solver.bestMoveChest(
    available,
    board,
    CHEST_THRESHOLDS.silver - state.score,
    CHEST_THRESHOLDS.gold - state.score,
    true,
  );
  if (!best) return null;

  // Map card ids back to the slots the UI works in.
  const slots = best.cards.map((id) => state.board.indexOf(id));
  if (slots.some((s) => s < 0)) return null;

  const pct = (x) => Math.round(x * 100) + "%";
  const odds = `Silver ${pct(best.pSilver)} · gold ${pct(best.pGold)} — exact, not an estimate.`;
  if (best.kind === "pick") {
    // type/label so an exact suggestion is shaped exactly like a heuristic one.
    const { type, label } = scoreHand(best.cards);
    return {
      kind: "pick",
      slots,
      cards: best.cards,
      score: best.gained,
      type,
      label,
      exact: best,
      reasoning: `Pick ${label} for ${best.gained} pts. ${odds}`,
    };
  }
  return {
    kind: "discard",
    slots,
    cards: best.cards,
    expectedAfter: 0,
    exact: best,
    reasoning: `Discard ${best.cards[0]}. ${odds}`,
  };
}

// Is a better chest still reachable at all?
//
// Two ways to answer, and we take the sharper one available:
//
//   exact    — with few enough cards left, the value curve says it outright:
//              the highest threshold with a non-zero probability IS the most
//              that can still be scored.
//   optimistic — otherwise, pack the best disjoint combos still alive into the
//              rounds still available. That ignores the 5-slot window, so it
//              over-estimates — which is the safe direction here: we only ever
//              call a run finished when even the optimistic bound falls short.
//
// Returns { canImprove, maxRemaining, nextThreshold, exact }.
export function chestOutlook(state, options = {}) {
  const deck = deckRemaining(state);
  const boardCards = state.board.filter(Boolean);
  const cardsInPlay = deck.length + boardCards.length;
  const score = state.score;

  const nextThreshold =
    score < CHEST_THRESHOLDS.silver ? CHEST_THRESHOLDS.silver
    : score < CHEST_THRESHOLDS.gold ? CHEST_THRESHOLDS.gold
    : null; // already gold — nothing better exists

  if (nextThreshold === null) {
    return { canImprove: false, maxRemaining: 0, nextThreshold: null, exact: true };
  }

  let maxRemaining = null;
  let exact = false;
  if (boardCards.length >= 3 && cardsInPlay <= (options.exactMaxCards ?? EXACT_MAX_CARDS)) {
    try {
      const available = maskOf([...deck, ...boardCards]);
      const board = maskOf(boardCards);
      let solver = options.cache && options.cache.solver;
      if (!solver) {
        solver = new EndgameSolver();
        solver.prepare(available);
        if (options.cache) options.cache.solver = solver;
      }
      const curve = solver.value(available, board);
      let top = 0;
      for (let i = curve.length - 1; i >= 0; i--) {
        if (curve[i] > 0) { top = i; break; }
      }
      maxRemaining = top * 10;
      exact = true;
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
    }
  }
  if (maxRemaining === null) {
    const rounds = Math.floor(cardsInPlay / 3);
    maxRemaining = bestAchievable(makeAvailableSet(deck, state.board), rounds);
  }

  return {
    canImprove: score + maxRemaining >= nextThreshold,
    maxRemaining,
    nextThreshold,
    exact,
  };
}

// options.cache — pass a createPolicyCache() per game to keep the exact table.
// options.mode — "auto" (default), "exact", "rollout", "heuristic".
export function suggest(state, options = {}) {
  const deck = deckRemaining(state);
  const boardCards = state.board.filter(Boolean);
  if (boardCards.length === 0) return null;
  const cardsInPlay = deck.length + boardCards.length;
  const mode = options.mode ?? "auto";

  // Nothing to search while the field is still being filled in: with fewer
  // than 3 cards there is no hand to take, so the only advice is which card to
  // throw. The cheap heuristic answers that in 0.1 ms and keeps card entry
  // from feeling sticky.
  if (mode === "auto" && boardCards.length < 3) return suggestMove(state, options);

  if (mode === "heuristic") return suggestMove(state, options);
  if (mode === "rollout") return suggestMoveRollout(state, options);

  if (mode === "exact" || cardsInPlay <= (options.exactMaxCards ?? EXACT_MAX_CARDS)) {
    try {
      const exact = exactSuggestion(state, deck, options.cache);
      if (exact) return exact;
    } catch (e) {
      // Only a blown node limit falls through to the cheaper method.
      if (!(e instanceof RangeError)) throw e;
    }
  }
  return suggestMoveRollout(state, options);
}
