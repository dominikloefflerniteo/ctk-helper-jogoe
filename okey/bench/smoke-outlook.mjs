// Does the "no better chest possible" detector fire when it should — and never
// while a better chest is still on?
import { createState, autoFillBoardFromDeck, confirmPick, discardSlot, deckRemaining,
  filledCards, chestForScore, CHEST_THRESHOLDS } from "../game.js";
import { suggest, createPolicyCache, chestOutlook } from "../policy.js";

let stoppedEarly = 0, playedOut = 0, wrongCalls = 0;
for (let g = 0; g < 250; g++) {
  const state = createState();
  const cache = createPolicyCache();
  let guard = 40, ended = null;
  while (guard-- > 0) {
    autoFillBoardFromDeck(state, Math.random);
    if (filledCards(state).length < 3) break;
    const outlook = chestOutlook(state, { cache });
    if (!outlook.canImprove) { ended = { ...outlook, score: state.score }; break; }
    const move = suggest(state, { cache });
    if (!move) break;
    if (move.kind === "pick") { confirmPick(state, move.slots); continue; }
    if (deckRemaining(state).length === 0) break;
    discardSlot(state, move.slots[0]);
  }
  if (ended) {
    stoppedEarly++;
    // sanity: keep playing anyway and check the score never crosses the line
    const before = ended.score;
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
    const target = before < CHEST_THRESHOLDS.silver ? CHEST_THRESHOLDS.silver : CHEST_THRESHOLDS.gold;
    if (state.score >= target && before < CHEST_THRESHOLDS.gold) wrongCalls++;
  } else playedOut++;
}
console.log(`250 runs: detector fired in ${stoppedEarly}, ran to the end in ${playedOut}`);
console.log(`false "nothing more possible" calls (a better chest was still reachable): ${wrongCalls}`);
