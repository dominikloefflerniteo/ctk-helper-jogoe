// Dump any position where the detector said "nothing better possible" and the
// run then reached a better chest anyway.
import { createState, autoFillBoardFromDeck, confirmPick, discardSlot, deckRemaining,
  filledCards, CHEST_THRESHOLDS } from "../game.js";
import { suggest, createPolicyCache, chestOutlook } from "../policy.js";

for (let g = 0; g < 600; g++) {
  const state = createState();
  const cache = createPolicyCache();
  let guard = 40, fired = null;
  while (guard-- > 0) {
    autoFillBoardFromDeck(state, Math.random);
    if (filledCards(state).length < 3) break;
    const o = chestOutlook(state, { cache });
    if (!o.canImprove) {
      fired = { ...o, score: state.score, board: [...state.board],
        deck: deckRemaining(state).length, inPlay: deckRemaining(state).length + filledCards(state).length };
      break;
    }
    const move = suggest(state, { cache });
    if (!move) break;
    if (move.kind === "pick") { confirmPick(state, move.slots); continue; }
    if (deckRemaining(state).length === 0) break;
    discardSlot(state, move.slots[0]);
  }
  if (!fired) continue;
  const target = fired.score < CHEST_THRESHOLDS.silver ? CHEST_THRESHOLDS.silver : CHEST_THRESHOLDS.gold;
  let guard2 = 40;
  while (guard2-- > 0) {
    autoFillBoardFromDeck(state, Math.random);
    if (filledCards(state).length < 3) break;
    const move = suggest(state, { cache });
    if (!move) break;
    if (move.kind === "pick") { confirmPick(state, move.slots); continue; }
    if (deckRemaining(state).length === 0) break;
    discardSlot(state, move.slots[0]);
  }
  if (state.score >= target && fired.score < CHEST_THRESHOLDS.gold) {
    console.log("FALSE CALL");
    console.log("  score when it fired :", fired.score, " target:", target);
    console.log("  claimed max remaining:", fired.maxRemaining, " exact:", fired.exact);
    console.log("  cards in play:", fired.inPlay, " deck:", fired.deck);
    console.log("  board:", fired.board.join(" "));
    console.log("  score actually reached:", state.score);
    break;
  }
}
console.log("done");
