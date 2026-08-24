// One full game played by the combined policy, showing which engine answered
// each turn and how long it took.
import { createState, autoFillBoardFromDeck, deckRemaining, confirmPick, discardSlot, filledCards } from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";

const state = createState();
const cache = createPolicyCache();
let turn = 0;
while (turn++ < 40) {
  autoFillBoardFromDeck(state, Math.random);
  if (filledCards(state).length < 3) break;
  const inPlay = deckRemaining(state).length + filledCards(state).length;
  const t0 = Date.now();
  const move = suggest(state, { cache });
  if (!move) break;
  const engine = move.exact ? "exact  " : "rollout";
  console.log(`${String(inPlay).padStart(2)} cards | ${engine} | ${String(Date.now() - t0).padStart(4)} ms | ${move.reasoning.slice(0, 70)}`);
  if (move.kind === "pick") { confirmPick(state, move.slots); continue; }
  if (deckRemaining(state).length === 0) break;
  discardSlot(state, move.slots[0]);
}
console.log("final score:", state.score);
