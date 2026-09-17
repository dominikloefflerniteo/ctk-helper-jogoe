// Routes to the strongest available engine:
//   ≤ EXACT_MAX_CARDS → exact MDP solver (EndgameSolver)
//   otherwise         → policy rollout (rollout.js)
// The cutoff is a latency budget, not a quality judgement.
// 14 cards ≈ 1.9 s in the worker thread; sub-positions are memoised so
// only the first exact turn is expensive.

import { deckRemaining, CHEST_THRESHOLDS, scoreHand, BOARD_SIZE } from "./game.js";
import { EndgameSolver, maskOf } from "./endgame.js";
import { makeAvailableSet, bestAchievable } from "./potential.js";
import { suggestMoveRollout, DEFAULT_BASE } from "./rollout.js";
import { suggestMove } from "./solver.js";

export const EXACT_MAX_CARDS = 14;

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

// Checks whether a better chest is still reachable.
// Uses the exact value curve when cards ≤ EXACT_MAX_CARDS, otherwise an
// optimistic greedy bound (safe: we only call a run finished when even
// the optimistic bound falls short).
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

  // Slots the player has not typed in yet are cards the game has already
  // dealt — they are not a smaller field. Ask the solver for the position
  // AFTER those slots are filled, or a hand that needs all five slots at once
  // reads as unreachable and the run gets called finished while it isn't.
  const missing = Math.min(BOARD_SIZE - boardCards.length, deck.length);

  let maxRemaining = null;
  let exact = false;
  if (boardCards.length + missing >= 3 && cardsInPlay <= (options.exactMaxCards ?? EXACT_MAX_CARDS)) {
    try {
      const available = maskOf([...deck, ...boardCards]);
      const board = maskOf(boardCards);
      let solver = options.cache && options.cache.solver;
      if (!solver) {
        solver = new EndgameSolver();
        solver.prepare(available);
        if (options.cache) options.cache.solver = solver;
      }
      const curve = solver.valueAfterFill(available, board, missing);
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

// options.cache — per-game cache keeps the exact table alive across turns.
// options.mode  — "auto" | "exact" | "rollout" | "heuristic".
export function suggest(state, options = {}) {
  const deck = deckRemaining(state);
  const boardCards = state.board.filter(Boolean);
  if (boardCards.length === 0) return null;
  const cardsInPlay = deck.length + boardCards.length;
  const mode = options.mode ?? "auto";

  // With < 3 cards there is no hand to score; heuristic handles discard-only.
  if (mode === "auto" && boardCards.length < 3) return suggestMove(state, options);

  // Use the same base params as the rollout playout policy for consistency.
  if (mode === "heuristic") return suggestMove(state, {
    ...DEFAULT_BASE,
    ...options,
    mode: undefined,
  });
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
