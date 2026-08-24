// Card potential — what a single card is still worth, given the exact set of
// cards that are still in play.
//
// The deck is perfect information: 24 unique cards (1..8 x R/B/Y), and a card
// that has been picked or discarded never comes back. So at any moment we know
// exactly which combos are still ALIVE:
//
//   three of a kind (value v)  needs all three colors of v  -> 20 + (v-1)*10
//   same-color run (low L)     needs c(L), c(L+1), c(L+2)   -> 50 + (L-1)*10
//   mixed run (low L)          needs one card of each of     -> L * 10
//                              L, L+1, L+2 (any colors)
//
// potentialOf(card) = the best alive combo that card can still join. That is
// the honest replacement for a flat opportunity-cost constant: dumping a card
// whose partners are all gone costs almost nothing, dumping the B7 while B6
// and B8 are alive costs a 100-point run.

import { COLORS, VALUES, parseCardId } from "./game.js";

const MIN_RUN_LOW = 1;
const MAX_RUN_LOW = 6; // runs are L, L+1, L+2 with L+2 <= 8

export function scoreTriple(v) { return 20 + (v - 1) * 10; }
export function scoreSameRun(low) { return 50 + (low - 1) * 10; }
export function scoreMixedRun(low) { return low * 10; }

// availableSet: Set of cardIds still in play (deck + face-up board).
export function makeAvailableSet(deckCards, boardCards) {
  const s = new Set(deckCards);
  for (const c of boardCards) if (c) s.add(c);
  return s;
}

function valueIsAvailable(available, v) {
  for (const c of COLORS) if (available.has(`${c}${v}`)) return true;
  return false;
}

// Best alive combo score containing `id`. Always >= 10 while the card exists
// in a run-able neighbourhood; 0 only if nothing at all can be formed.
export function potentialOf(id, available) {
  const { color, value } = parseCardId(id);
  let best = 0;

  // three of a kind: needs the other two colors of the same value
  let allColors = true;
  for (const c of COLORS) if (!available.has(`${c}${value}`)) { allColors = false; break; }
  if (allColors) best = Math.max(best, scoreTriple(value));

  const lowFrom = Math.max(MIN_RUN_LOW, value - 2);
  const lowTo = Math.min(MAX_RUN_LOW, value);
  for (let low = lowFrom; low <= lowTo; low++) {
    // same-color run
    if (available.has(`${color}${low}`) &&
        available.has(`${color}${low + 1}`) &&
        available.has(`${color}${low + 2}`)) {
      best = Math.max(best, scoreSameRun(low));
    }
    // mixed run: any color per value is fine
    if (valueIsAvailable(available, low) &&
        valueIsAvailable(available, low + 1) &&
        valueIsAvailable(available, low + 2)) {
      best = Math.max(best, scoreMixedRun(low));
    }
  }
  return best;
}

// Convenience: potentials for a whole board (nulls -> 0).
export function boardPotentials(board, available) {
  return board.map((c) => (c ? potentialOf(c, available) : 0));
}

// Total remaining upside of the cards still in play: greedy set-packing over
// alive combos, highest score first. Used as a state value function / for
// reporting "how much is still on the table".
// Highest total still theoretically reachable. Used to decide whether a better
// chest is possible at all, so it MUST NOT come out too low — calling a run
// finished while it is still winnable is the one unacceptable error.
//
// packCombos only knows triples and same-colour runs. A position whose only
// remaining scoring options are mixed runs would come back as 0, which is
// exactly that unacceptable error (it happened once in 26 detector firings
// before mixed runs were added here). Mixed runs are therefore thrown into the
// pool without a disjointness check: that can over-count, and over-counting is
// the harmless direction.
export function bestAchievable(available, maxPicks) {
  if (maxPicks <= 0) return 0;
  const pool = [...packCombos(available), ...mixedRunScores(available)];
  pool.sort((a, b) => b - a);
  return pool.slice(0, maxPicks).reduce((a, b) => a + b, 0);
}

// Score of every mixed run still formable: three consecutive values, each of
// which still exists in some colour.
function mixedRunScores(available) {
  const out = [];
  for (let low = MIN_RUN_LOW; low <= MAX_RUN_LOW; low++) {
    if (valueIsAvailable(available, low) &&
        valueIsAvailable(available, low + 1) &&
        valueIsAvailable(available, low + 2)) {
      out.push(scoreMixedRun(low));
    }
  }
  return out;
}

function packCombos(available) {
  const combos = [];
  for (const v of VALUES) {
    let ok = true;
    for (const c of COLORS) if (!available.has(`${c}${v}`)) { ok = false; break; }
    if (ok) combos.push({ score: scoreTriple(v), cards: COLORS.map((c) => `${c}${v}`) });
  }
  for (const c of COLORS) {
    for (let low = MIN_RUN_LOW; low <= MAX_RUN_LOW; low++) {
      const cards = [`${c}${low}`, `${c}${low + 1}`, `${c}${low + 2}`];
      if (cards.every((id) => available.has(id))) {
        combos.push({ score: scoreSameRun(low), cards });
      }
    }
  }
  combos.sort((a, b) => b.score - a.score);

  const used = new Set();
  const out = [];
  for (const combo of combos) {
    if (combo.cards.some((id) => used.has(id))) continue;
    for (const id of combo.cards) used.add(id);
    out.push(combo.score);
  }
  return out;
}

export function deckPotential(available) {
  return packCombos(available).reduce((a, b) => a + b, 0);
}

// ---------- board-aware potential ----------
//
// potentialOf() judges a card in isolation: the lone R6 and the R6 sitting
// next to an R7 both score "a 100-point run is still alive". But those are
// completely different cards to hold. Completing a combo means gathering all
// three cards in a 5-slot window one draw at a time, so a card whose partners
// are ALREADY face-up is worth far more than one whose partners are somewhere
// in the deck.
//
// synergyPotential weights each alive combo by how many of its other two
// cards are already on the board:
//
//   2 partners on board -> 1.00  (one draw away; in practice we just pick it)
//   1 partner on board  -> PARTNER_WEIGHT
//   0 partners on board -> LONE_WEIGHT
//
// Defaults grid-searched in bench/benchmark.mjs.
export const LONE_WEIGHT = 0.25;
export const PARTNER_WEIGHT = 0.55;

function comboPartners(id, available) {
  const { color, value } = parseCardId(id);
  const out = [];

  let allColors = true;
  for (const c of COLORS) if (!available.has(`${c}${value}`)) { allColors = false; break; }
  if (allColors) {
    out.push({
      score: scoreTriple(value),
      partners: COLORS.filter((c) => c !== color).map((c) => `${c}${value}`),
    });
  }

  const lowFrom = Math.max(MIN_RUN_LOW, value - 2);
  const lowTo = Math.min(MAX_RUN_LOW, value);
  for (let low = lowFrom; low <= lowTo; low++) {
    const same = [`${color}${low}`, `${color}${low + 1}`, `${color}${low + 2}`];
    if (same.every((c) => available.has(c))) {
      out.push({ score: scoreSameRun(low), partners: same.filter((c) => c !== id) });
    }
    // Mixed runs: the cheapest partner of each neighbouring value that is
    // still alive. Low value, but it keeps dead-end cards from reading as 0.
    const neighbours = [low, low + 1, low + 2].filter((v) => v !== value);
    const picks = [];
    for (const v of neighbours) {
      const found = COLORS.map((c) => `${c}${v}`).find((c) => available.has(c) && c !== id);
      if (found) picks.push(found);
    }
    if (picks.length === neighbours.length) {
      out.push({ score: scoreMixedRun(low), partners: picks });
    }
  }
  return out;
}

// `exclude` (array of 3 cardIds) drops one combo from consideration. Needed
// when costing a PICK: the cards of the hand we are about to take obviously
// all sit on the board, so without the exclusion every pick would look free.
// What we actually want to know is what those cards could do INSTEAD.
export function synergyPotential(id, board, available, weights = {}, exclude = null) {
  const lone = weights.lone ?? LONE_WEIGHT;
  const partnerW = weights.partner ?? PARTNER_WEIGHT;
  const onBoard = new Set(board.filter(Boolean));
  const excludeKey = exclude ? [...exclude].sort().join(",") : null;

  let best = 0;
  for (const combo of comboPartners(id, available)) {
    if (excludeKey && [id, ...combo.partners].sort().join(",") === excludeKey) continue;
    let have = 0;
    for (const p of combo.partners) if (onBoard.has(p)) have++;
    const w = have >= 2 ? 1 : have === 1 ? partnerW : lone;
    best = Math.max(best, combo.score * w);
  }
  return best;
}
