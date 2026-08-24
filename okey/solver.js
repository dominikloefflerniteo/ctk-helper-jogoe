// Okey solver. Two responsibilities:
//
//   1. rankCombos(board) — score every C(5,3) three-card pick (used by the
//      "all combos" panel and by the EV calculation below).
//   2. suggestMove(state) — decides between PICKING the best 3 from the field
//      now vs DISCARDING some subset to draw replacements. For each non-empty
//      subset D of currently-filled slots, computes the expected score of the
//      best 3-pick after replacing D with random cards from the remaining
//      deck (sampling without replacement, exact enumeration). Picks if no
//      discard improves on the current best; otherwise recommends the subset
//      with the highest expected score.

import { scoreHand, COLOR_NAMES, deckRemaining, BOARD_SIZE, CHEST_THRESHOLDS, COLORS, parseCardId } from "./game.js";
import { makeAvailableSet, potentialOf, synergyPotential } from "./potential.js";

function* combos3(n) {
  for (let i = 0; i < n - 2; i++)
    for (let j = i + 1; j < n - 1; j++)
      for (let k = j + 1; k < n; k++) yield [i, j, k];
}

// All k-element index combinations of [0..n).
function* combosK(n, k) {
  if (k === 0) { yield []; return; }
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// ---------- pick scoring (existing API) ----------

export function rankCombos(board) {
  const filled = [];
  for (let i = 0; i < board.length; i++) if (board[i]) filled.push(i);
  if (filled.length < 3) return [];

  const out = [];
  for (const [a, b, c] of combos3(filled.length)) {
    const slots = [filled[a], filled[b], filled[c]];
    const cards = slots.map((s) => board[s]);
    const result = scoreHand(cards);
    out.push({ slots, cards, ...result });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

export function bestPick(board) {
  const ranked = rankCombos(board);
  return ranked[0] || null;
}

// ---------- discard expected-value ----------

// Best 3-pick score on a 5-slot array (some may be null) — convenience for
// the EV inner loop.
function bestPickScore(boardArr) {
  const ranked = rankCombos(boardArr);
  return ranked.length ? ranked[0].score : 0;
}

// Expected best-pick score after discarding `discardSlots` and drawing
// |discardSlots| random replacement cards (without replacement) from `deck`.
// Returns null if the deck is too small to refill.
export function expectedScoreAfterDiscard(board, discardSlots, deck) {
  const k = discardSlots.length;
  if (k > deck.length) return null;
  if (k === 0) return bestPickScore(board);

  // Slots we keep (their cards survive).
  const keepSlots = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] && !discardSlots.includes(i)) keepSlots.push(i);
  }
  const keepCards = keepSlots.map((s) => board[s]);

  let total = 0;
  let count = 0;
  for (const drawIdx of combosK(deck.length, k)) {
    const drawn = drawIdx.map((i) => deck[i]);
    const newBoard = [...keepCards, ...drawn];
    while (newBoard.length < BOARD_SIZE) newBoard.push(null);
    total += bestPickScore(newBoard);
    count++;
  }
  return count > 0 ? total / count : 0;
}


// ---------- exact EV, computed cheaply ----------
//
// expectedScoreAfterDiscard() re-ranks the whole 5-card board once per deck
// card. That is O(deck * 10) hand scorings per candidate discard, and it is
// the reason the solver is too slow to put inside a search.
//
// It is also unnecessary. After discarding one card, four cards stay. A drawn
// card can only score by joining TWO of those four, so:
//
//     best pick after the draw = max(best pick among the 4 kept,
//                                    best combo the drawn card forms with a pair)
//
// The second term is a lookup: enumerate the C(4,2)=6 pairs once, write down
// which single card completes each of them and for how many points, then walk
// the deck. Same numbers as the old function, ~20x less work.
//
// completionsFor returns Map(cardId -> best score that card would create).
function completionsFor(kept) {
  const out = new Map();
  const bump = (id, score) => {
    const prev = out.get(id);
    if (prev === undefined || score > prev) out.set(id, score);
  };

  for (let i = 0; i < kept.length - 1; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = parseCardId(kept[i]);
      const b = parseCardId(kept[j]);

      if (a.value === b.value) {
        // third colour of the same value completes a three-of-a-kind
        for (const c of COLORS) {
          if (c === a.color || c === b.color) continue;
          bump(`${c}${a.value}`, scoreHand([kept[i], kept[j], `${c}${a.value}`]).score);
        }
        continue;
      }

      const lo = Math.min(a.value, b.value);
      const hi = Math.max(a.value, b.value);
      const gap = hi - lo;
      if (gap > 2) continue;

      // Which values would turn the pair into three consecutive values?
      const wanted = gap === 2 ? [lo + 1] : [lo - 1, hi + 1];
      for (const v of wanted) {
        if (v < 1 || v > 8) continue;
        for (const c of COLORS) {
          const id = `${c}${v}`;
          if (id === kept[i] || id === kept[j]) continue;
          bump(id, scoreHand([kept[i], kept[j], id]).score);
        }
      }
    }
  }
  return out;
}

// Expected best-pick score after discarding one card and drawing one, exact.
export function evAfterSingleDiscard(kept, deck) {
  if (deck.length === 0) return null;
  const keptBoard = [...kept];
  while (keptBoard.length < BOARD_SIZE) keptBoard.push(null);
  const base = bestPickScore(keptBoard);
  const completions = completionsFor(kept);

  let total = 0;
  for (const card of deck) {
    const withDraw = completions.get(card) ?? 0;
    total += withDraw > base ? withDraw : base;
  }
  return total / deck.length;
}

// ---------- suggestion entry point ----------

// Returns one of:
//   { kind: "pick",    slots, cards, score, type, label, reasoning }
//   { kind: "discard", slots, expectedAfter, reasoning }
//   null  — nothing on the board
//
// Why we only consider single-card discards: sequential single discards
// weakly dominate any batch discard in EV. After each single discard you see
// the new card and can choose pick / discard-another, which is strictly more
// flexible than committing to "discard N at once". So the optimal policy is
// always a sequence of single discards (or pick).
//
// Why we charge OPPORTUNITY_COST per discard: each discard burns one card
// from the deck — that's ~1/3 of a future pick (since picks consume 3
// cards). Without this charge, the solver "infinitely" discards low-EV
// improvements and runs the deck dry on marginal draws (avg ~169pts in
// 2000-game simulation, 94% bronze). With the charge, it stops chasing
// trivial improvements and accumulates picks (266pts avg, 29% silver, 2.5%
// gold). Empirically tuned via grid search; OC=5 was best in [1..12], with
// a flat plateau around 4-6 (so the value isn't fragile).

const EV_TIE_EPSILON = 0.01;
const OPPORTUNITY_COST_PER_DISCARD = 5;

// ---------- v2: potential-based costs ----------
//
// v1 (above) charges a flat 5 points per discard and judges a pick purely by
// its own score. Both are blind to WHICH cards are being spent. v2 replaces
// them with the exact card potential (see potential.js):
//
//   discard cost   = lambda * potential(card) / 3
//       A combo eats three cards, so one card is worth ~1/3 of the best combo
//       it could still join. Dumping a dead 2 costs ~3 pts; dumping the B7
//       between a live B6 and B8 costs ~33.
//
//   pick damage    = lambda * max(0, avg(potential of the 3 cards) - score)
//       Taking a mixed 6-7-8 for 60 spends three cards that were each worth
//       ~90 in the best case -> it is punished. Taking a same-color 6-7-8 for
//       100 spends cards worth exactly that -> free.
//
// Net effect: the solver stops cannibalising high cards for cheap mixed runs
// and stops churning discards on cards nothing can use.
// lambda weights the potential terms against raw points. Grid-searched on
// 5000 games (bench/benchmark.mjs --sweep): monotone up to ~6, then a flat
// plateau through 20 (45.5% silver either way), so 6 sits mid-plateau and is
// not fragile.
const DEFAULT_LAMBDA = 6;

// `options.policy`: "v1" (flat opportunity cost) or "v2" (potential-based,
// default). `options.opportunityCost` / `options.lambda` tune them; only the
// offline benchmark passes these — the UI calls suggestMove(state).
export function suggestMove(state, options = {}) {
  const policy = options.policy ?? "v2";
  if (policy === "fast") return suggestMoveFast(state, options);
  if (policy === "v1") return suggestMoveV1(state, options);
  return suggestMoveV2(state, options);
}

// How many scoring rounds are still physically possible: every pick eats 3
// cards and every discard eats 1, so the cards left (deck + face-up) divided
// by 3 is the hard ceiling on remaining picks.
export function picksLeft(state) {
  const deck = deckRemaining(state);
  let filled = 0;
  for (const c of state.board) if (c) filled++;
  return Math.floor((deck.length + filled) / 3);
}

function suggestMoveV2(state, options = {}) {
  const lambda = options.lambda ?? DEFAULT_LAMBDA;
  const endgame = options.endgame ?? true;
  const board = state.board;
  const filledIndices = [];
  for (let i = 0; i < board.length; i++) if (board[i]) filledIndices.push(i);
  if (filledIndices.length === 0) return null;

  const deck = deckRemaining(state);
  const available = makeAvailableSet(deck, board);
  // v4 (REJECTED, kept for the record): board-aware potential, see
  // potential.js. Weighting combos by how many partners are already face-up
  // lost on every setting; a weight sweep converged monotonically on 1.0/1.0,
  // i.e. on plain v2. Off by default; options.synergy=true to re-measure.
  const useSynergy = options.synergy ?? false;
  const weights = { lone: options.lone, partner: options.partner };
  const potential = {};
  for (const i of filledIndices) {
    potential[i] = useSynergy
      ? synergyPotential(board[i], board, available, weights)
      : potentialOf(board[i], available);
  }

  // Endgame: card potential is only worth protecting while there are rounds
  // left to cash it in. On the last round a "valuable" card that we cannot
  // spend is worth nothing, so the cost terms fade out.
  const rounds = Math.floor((deck.length + filledIndices.length) / 3);
  const scale = endgame ? Math.max(0, Math.min(1, (rounds - 1) / 2)) : 1;
  if (endgame && rounds <= 1) {
    const final = finalRoundMove(state, board, deck, filledIndices);
    if (final) return final;
  }

  // Evaluate EVERY C(5,3) pick, not just the highest-scoring one. The best
  // pick by raw points is often the worst by net value: a mixed 6-7-8 scores
  // 60 but spends three cards that a same-colour run would pay 100 for, while
  // the triple 3s next to it scores 40 out of cards nothing else wants.
  const ranked = rankCombos(board);
  let pick = null;
  let pickNet = -Infinity;
  let pickDamage = 0;
  for (const cand of ranked) {
    if (cand.score <= 0) continue;
    // Cost a pick against what its cards could do INSTEAD — the combo being
    // taken is excluded, otherwise every completed hand costs nothing.
    const altPot = useSynergy
      ? cand.slots.map((s) => synergyPotential(board[s], board, available, weights, cand.cards))
      : cand.slots.map((s) => potential[s]);
    const avgPot = altPot.reduce((a, b) => a + b, 0) / 3;
    const damage = lambda * scale * Math.max(0, avgPot - cand.score);
    const net = cand.score - damage;
    if (net > pickNet) { pickNet = net; pick = cand; pickDamage = damage; }
  }
  if (!pick) {
    pick = ranked.length ? ranked[0] : null;
    pickNet = pick ? -Infinity : -Infinity;
    pickDamage = 0;
  }
  const pickScore = pick ? pick.score : 0;

  let bestDiscard = null;
  for (const slot of filledIndices) {
    const kept = [];
    for (const i of filledIndices) if (i !== slot) kept.push(board[i]);
    const ev = evAfterSingleDiscard(kept, deck);
    if (ev === null) continue;
    const cost = lambda * scale * (potential[slot] / 3);
    const net = ev - cost;
    if (bestDiscard === null || net > bestDiscard.net) {
      bestDiscard = { slots: [slot], expectedAfter: ev, cost, net };
    }
  }

  if (!pick && !bestDiscard) return null;
  if (!pick) return makeDiscardV2(state, bestDiscard, pickScore);
  if (!bestDiscard) return makePickV2(pick, null, pickDamage);

  if (bestDiscard.net > pickNet + EV_TIE_EPSILON) {
    return makeDiscardV2(state, bestDiscard, pickScore);
  }
  return makePickV2(pick, bestDiscard, pickDamage);
}



// ---------- fast policy (rollout base) ----------
//
// v2 enumerates the whole deck for every candidate discard. That is fine for
// a single suggestion but far too slow to use as the inner policy of a
// rollout search. This is the same idea without the enumeration:
//
//   pick the highest-net hand if that net clears a bar, otherwise throw the
//   card with the least remaining potential.
//
// The bar falls as the deck empties: early on a 40-point hand is not worth
// three cards, on the last round it is everything we are going to get.
const FAST_BAR = 62;

export function suggestMoveFast(state, options = {}) {
  const lambda = options.lambda ?? DEFAULT_LAMBDA;
  const bar = options.bar ?? FAST_BAR;
  const board = state.board;
  const filledIndices = [];
  for (let i = 0; i < board.length; i++) if (board[i]) filledIndices.push(i);
  if (filledIndices.length === 0) return null;

  const deck = deckRemaining(state);
  const available = makeAvailableSet(deck, board);
  const potential = {};
  for (const i of filledIndices) potential[i] = potentialOf(board[i], available);

  const rounds = Math.floor((deck.length + filledIndices.length) / 3);
  const scale = Math.max(0, Math.min(1, (rounds - 1) / 2));

  const ranked = rankCombos(board);
  let pick = null, pickNet = -Infinity;
  for (const cand of ranked) {
    if (cand.score <= 0) continue;
    const avgPot = cand.slots.reduce((a, sl) => a + potential[sl], 0) / 3;
    const net = cand.score - lambda * scale * Math.max(0, avgPot - cand.score);
    if (net > pickNet) { pickNet = net; pick = cand; }
  }

  // Bar scales with how much game is left: no rounds left to build anything
  // means take what is on the table.
  const effectiveBar = bar * scale;
  if (pick && (pickNet >= effectiveBar || deck.length === 0)) {
    return { kind: "pick", slots: pick.slots, cards: pick.cards, score: pick.score,
      type: pick.type, label: pick.label, reasoning: `Pick ${formatHandLabel(pick)} for ${pick.score} pts.` };
  }
  if (deck.length === 0) return pick ? { kind: "pick", slots: pick.slots, cards: pick.cards,
    score: pick.score, type: pick.type, label: pick.label, reasoning: "Deck is empty — take the best hand left." } : null;

  let worst = filledIndices[0];
  for (const i of filledIndices) if (potential[i] < potential[worst]) worst = i;
  return { kind: "discard", slots: [worst], cards: [board[worst]], expectedAfter: 0,
    reasoning: `Discard ${prettyCard(board[worst])} — least useful card left on the field.` };
}

// ---------- final round: play the threshold, not the average ----------
//
// Chests are thresholds, not points. With one pick left, a move that adds 30
// points is worthless at 250 (still bronze) and decisive at 280. So on the
// last round we stop maximising expected points and maximise
// P(reach the next chest) instead, tie-broken by P(reach the one above) and
// then by expected points.
//
// Target: silver while we are below it, gold once silver is banked.
function chestTarget(score) {
  return score < CHEST_THRESHOLDS.silver ? CHEST_THRESHOLDS.silver : CHEST_THRESHOLDS.gold;
}

// Distribution of the best pick available after discarding `slot` and drawing
// one card: exact, since every remaining deck card is equally likely.
function drawStats(board, slot, deck, target, above) {
  if (deck.length === 0) return null;
  const keep = [];
  for (let i = 0; i < board.length; i++) if (board[i] && i !== slot) keep.push(board[i]);
  let hit = 0, hitAbove = 0, sum = 0;
  for (const card of deck) {
    const newBoard = [...keep, card];
    while (newBoard.length < BOARD_SIZE) newBoard.push(null);
    const best = bestPickScore(newBoard);
    if (best >= target) hit++;
    if (best >= above) hitAbove++;
    sum += best;
  }
  return { p: hit / deck.length, pAbove: hitAbove / deck.length, ev: sum / deck.length };
}

function finalRoundMove(state, board, deck, filledIndices) {
  const pick = bestPick(board);
  if (!pick) return null;
  const target = chestTarget(state.score);
  const need = target - state.score;
  const above = CHEST_THRESHOLDS.gold - state.score;

  // Already good enough? Bank it — no reason to gamble the chest away.
  if (pick.score >= need) return makePickV2(pick, null, 0);

  const pickStats = { p: 0, pAbove: 0, ev: pick.score };
  let best = { stats: pickStats, move: null };
  for (const slot of filledIndices) {
    const stats = drawStats(board, slot, deck, need, above);
    if (!stats) continue;
    const b = best.stats;
    const better = stats.p > b.p + 1e-9 ||
      (Math.abs(stats.p - b.p) <= 1e-9 && stats.pAbove > b.pAbove + 1e-9) ||
      (Math.abs(stats.p - b.p) <= 1e-9 && Math.abs(stats.pAbove - b.pAbove) <= 1e-9 && stats.ev > b.ev);
    if (better) best = { stats, move: { slots: [slot], expectedAfter: stats.ev, cost: 0 } };
  }

  if (!best.move) return makePickV2(pick, null, 0);
  const card = board[best.move.slots[0]];
  const chest = target === CHEST_THRESHOLDS.gold ? "gold" : "silver";
  return {
    kind: "discard",
    slots: best.move.slots,
    cards: [card],
    expectedAfter: best.stats.ev,
    reasoning: `Last round: picking now scores ${pick.score}, but you need ${need} for ${chest}. Discard ${prettyCard(card)} — that gives a ${(best.stats.p * 100).toFixed(0)}% chance of drawing into a big enough combo (E[${best.stats.ev.toFixed(1)}]).`,
  };
}

function makePickV2(pick, bestDiscard, pickDamage) {
  let note = "";
  if (pickDamage > 0.5) {
    note = ` These cards could still be worth more elsewhere (spend-cost ≈ ${pickDamage.toFixed(0)}), but nothing better is reachable.`;
  }
  if (bestDiscard && bestDiscard.expectedAfter > pick.score) {
    note += ` (One discard would yield E[${bestDiscard.expectedAfter.toFixed(1)}], but that card is worth ≈ ${bestDiscard.cost.toFixed(1)} to future combos.)`;
  }
  const reasoning = `Pick ${formatHandLabel(pick)} for ${pick.score} pts.${note}`;
  return {
    kind: "pick",
    slots: pick.slots,
    cards: pick.cards,
    score: pick.score,
    type: pick.type,
    label: pick.label,
    reasoning,
  };
}

function makeDiscardV2(state, bestDiscard, pickScore) {
  const slot = bestDiscard.slots[0];
  const card = state.board[slot];
  const compare = pickScore > 0 ? ` (best pick now: ${pickScore} pts)` : ` (no scoring combo on the field)`;
  const reasoning = `Discard ${prettyCard(card)} — nothing alive needs it (worth ≈ ${bestDiscard.cost.toFixed(1)}), and the redraw is worth E[${bestDiscard.expectedAfter.toFixed(1)}]${compare}.`;
  return {
    kind: "discard",
    slots: bestDiscard.slots,
    cards: [card],
    expectedAfter: bestDiscard.expectedAfter,
    reasoning,
  };
}

function suggestMoveV1(state, options = {}) {
  const opportunityCost = options.opportunityCost ?? OPPORTUNITY_COST_PER_DISCARD;
  const board = state.board;
  const filledIndices = [];
  for (let i = 0; i < board.length; i++) if (board[i]) filledIndices.push(i);
  if (filledIndices.length === 0) return null;

  const pick = bestPick(board);
  const pickScore = pick ? pick.score : 0;
  const deck = deckRemaining(state);

  // Best single-card discard: for each filled slot, expected best-pick score
  // after replacing that one card with a random draw from deckRemaining.
  let bestSingle = null;
  for (const slot of filledIndices) {
    const ev = expectedScoreAfterDiscard(board, [slot], deck);
    if (ev === null) continue;
    if (bestSingle === null || ev > bestSingle.expectedAfter) {
      bestSingle = { slots: [slot], expectedAfter: ev };
    }
  }

  const canPick = pick !== null;
  const canDiscard = bestSingle !== null;

  if (!canPick && !canDiscard) return null;
  if (!canPick) return makeDiscard(state, bestSingle, pickScore);
  if (!canDiscard) return makePick(pick, bestSingle, opportunityCost);

  // Discard wins only if its EV beats picking by at least the opportunity
  // cost of the card it burns (see comment at OPPORTUNITY_COST_PER_DISCARD).
  // Ties go to picking so the helper doesn't churn when the two are close.
  if (bestSingle.expectedAfter > pickScore + opportunityCost + EV_TIE_EPSILON) {
    return makeDiscard(state, bestSingle, pickScore);
  }
  return makePick(pick, bestSingle, opportunityCost);
}

function makePick(pick, bestSingle, opportunityCost = OPPORTUNITY_COST_PER_DISCARD) {
  // If a single discard had higher raw EV but lost out to the opportunity
  // cost, surface that — otherwise the user might think the solver missed it.
  let evNote = "";
  if (bestSingle) {
    const adj = bestSingle.expectedAfter - opportunityCost;
    if (bestSingle.expectedAfter > pick.score) {
      evNote = ` (one discard would yield E[${bestSingle.expectedAfter.toFixed(1)}], but with deck-burn cost ≈ ${opportunityCost} that's only ${adj.toFixed(1)} net).`;
    }
  }
  const reasoning = `Pick ${formatHandLabel(pick)} for ${pick.score} pts.${evNote}`;
  return {
    kind: "pick",
    slots: pick.slots,
    cards: pick.cards,
    score: pick.score,
    type: pick.type,
    label: pick.label,
    reasoning,
  };
}

function makeDiscard(state, bestSingle, pickScore) {
  const board = state.board;
  const slot = bestSingle.slots[0];
  const card = board[slot];
  const ev = bestSingle.expectedAfter.toFixed(1);
  const compare = pickScore > 0
    ? ` (best pick now: ${pickScore} pts)`
    : ` (no scoring combo on the field)`;
  const reasoning = `Discard ${prettyCard(card)} — E[best pick after draw] ≈ ${ev}${compare}. After you enter the new card, the helper will re-evaluate.`;
  return {
    kind: "discard",
    slots: bestSingle.slots,
    cards: [card],
    expectedAfter: bestSingle.expectedAfter,
    reasoning,
  };
}

// ---------- formatting helpers ----------

const TYPE_LABEL = {
  three: "three of a kind",
  sameSeq: "same-color run",
  mixedSeq: "mixed run",
  none: "no combo",
};

export function formatHandLabel(combo) {
  const cardStr = combo.cards.map(prettyCard).join(" · ");
  const typeStr = TYPE_LABEL[combo.type] || "—";
  return `${cardStr} — ${typeStr}`;
}

export function prettyCard(id) {
  const color = COLOR_NAMES[id[0]] || id[0];
  return `${color[0]}${id.slice(1)}`;
}
