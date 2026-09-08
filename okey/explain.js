// Why the suggested move is the suggested move, in cards rather than in
// percentages.
//
// The helper used to answer "Throw B3." and nothing else. That is the whole
// output, so a player who disagrees has no way to check it and no way to learn
// the game from it — the only options left are to trust it blindly or to ask
// someone. Both happened; the second one is how the ranking bug of 2026-09-08
// was found.
//
// Two rules this file exists to keep:
//
//   1. The reason is derived from the same numbers that chose the move (the
//      per-candidate stats every engine now returns), never from a second
//      opinion computed alongside it. A reason that can disagree with the
//      advice is worse than no reason at all.
//   2. It answers the question the player actually asks, which is never "why
//      this card?" but "why not that one?" — so the kept card that looks
//      throwable gets a sentence of its own.
//
// Output is structured, not prose: i18n.js turns it into a sentence in the
// player's language.

import { deckRemaining, parseCardId, scoreHand } from "./game.js";

// Every combo the card could still end up in, given what is left.
//
// "Left" means on the field or still in the deck — cards that are consumed are
// gone for good. Partners already on the field count as available, which is
// what makes the difference between a card that needs one draw and a card that
// needs two visible at all.
//
// Deliberately ignores the fact that a partner may be promised to a better
// combo elsewhere: this describes the card, and the engine has already priced
// the position.
export function cardOutlook(state, card) {
  const pool = [...deckRemaining(state), ...state.board.filter(Boolean)];
  const onBoard = new Set(state.board.filter(Boolean));
  let best = null;

  for (let i = 0; i < pool.length; i++) {
    if (pool[i] === card) continue;
    for (let j = i + 1; j < pool.length; j++) {
      if (pool[j] === card) continue;
      const hand = [card, pool[i], pool[j]];
      const { score, type, label } = scoreHand(hand);
      if (score === 0) continue;
      const partners = [pool[i], pool[j]];
      const missing = partners.filter((c) => !onBoard.has(c));
      const held = partners.filter((c) => onBoard.has(c));
      // Fewer draws beats more points: a 100 that needs both partners drawn is
      // not the reason to keep a card when a 70 needs one.
      if (!best
        || missing.length < best.missing.length
        || (missing.length === best.missing.length && score > best.score)) {
        best = { score, type, label, hand, missing, held };
      }
    }
  }
  return best; // null = dead card, no combination can include it any more
}

// The runner-up move and what choosing it would cost, read off the candidate
// list the engine itself ranked.
//
// Chest first, points second — the same order the engines decide in, so the
// sentence can never recommend something the ranking did not.
function runnerUp(chosen, candidates) {
  if (!candidates || candidates.length < 2) return null;
  const others = candidates.filter((c) => c !== chosen && c.key !== chosen.key);
  if (others.length === 0) return null;

  let next = others[0];
  for (const c of others) {
    const better = (c.pSilver + 2 * c.pGold) - (next.pSilver + 2 * next.pGold);
    if (better > 1e-9 || (Math.abs(better) <= 1e-9 && c.expected > next.expected)) next = c;
  }

  const chestGap = (chosen.pSilver + 2 * chosen.pGold) - (next.pSilver + 2 * next.pGold);
  if (chestGap > 0.02) {
    return { cards: next.cards, kind: "chest", pSilver: next.pSilver, pGold: next.pGold };
  }
  const pointGap = chosen.expected - next.expected;
  if (pointGap >= 5) return { cards: next.cards, kind: "points", points: Math.round(pointGap) };
  return { cards: next.cards, kind: "close" };
}

// Build the explanation for a move the engine has already chosen.
//
// `move` is what suggest() returned; `state` is the position it was asked
// about. Returns null when there is nothing worth saying (a forced move, or a
// board the engine answered from the cheap heuristic without candidates).
export function explainMove(state, move) {
  if (!move) return null;
  const candidates = move.candidates ?? null;
  const chosen = candidates
    ? candidates.find((c) => c.key === candidateKey(move.kind, move.cards))
    : null;

  const out = { kind: move.kind, cards: move.cards };

  if (move.kind === "pick") {
    out.score = move.score;
    out.label = move.label;
  } else {
    const thrown = move.cards[0];
    out.thrown = thrown;
    const outlook = cardOutlook(state, thrown);
    out.dead = outlook === null;
    if (outlook) {
      out.thrownBest = outlook.score;
      out.thrownMissing = outlook.missing;
    }

    // The "why not that one" sentence: of the cards that stay, the one whose
    // best combination is worth most is the one the player was eyeing.
    let keep = null;
    for (const card of state.board) {
      if (!card || card === thrown) continue;
      const o = cardOutlook(state, card);
      if (!o) continue;
      if (!keep || o.score > keep.outlook.score
        || (o.score === keep.outlook.score && o.missing.length < keep.outlook.missing.length)) {
        keep = { card, outlook: o };
      }
    }
    if (keep) {
      // Name the cards on the field that the combination is already built from,
      // not just the one card that happened to win the scan — "B3+B4 are waiting
      // for B5" is the sentence that answers "why is the B3 still there?", and
      // "B4 is waiting for B5" is not.
      out.keep = keep.card;
      out.keepCards = [keep.card, ...keep.outlook.held]
        .sort((a, b) => parseCardId(a).value - parseCardId(b).value);
      out.keepScore = keep.outlook.score;
      out.keepMissing = keep.outlook.missing;
      out.keepLabel = keep.outlook.label;
      out.keepType = keep.outlook.type;
    }
  }

  if (chosen) {
    out.pSilver = chosen.pSilver;
    out.pGold = chosen.pGold;
    out.exact = !!move.exact;
    out.alternative = runnerUp(chosen, candidates);
  }
  return out;
}

// Stable identity for a candidate move, so a suggestion can be matched back to
// its own row in the candidate list.
export function candidateKey(kind, cards) {
  return kind + ":" + [...cards].sort().join(",");
}

// Colour-blind-safe short name for a card, e.g. "R7" -> value 7 of red. The UI
// renders these as coloured chips; this is the fallback for plain text.
export function cardLabel(id, colorNames) {
  const { color, value } = parseCardId(id);
  return `${colorNames[color] ?? color} ${value}`;
}
