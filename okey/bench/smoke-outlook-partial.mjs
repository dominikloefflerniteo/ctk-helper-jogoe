// The detector on a field the player has not finished typing in.
//
// Empty slots are cards the game has already dealt, not a narrower field. Read
// as a smaller board they cost the run every line that needs all five slots at
// once — which is how a position with silver locked in got the "nothing better
// is possible" overlay (reported 2026-08-31, first case below).
import { createState, autoFillBoardFromDeck, confirmPick, discardSlot,
  deckRemaining, filledCards, COLORS, VALUES, BOARD_SIZE } from "../game.js";
import { suggest, createPolicyCache, chestOutlook } from "../policy.js";

let failures = 0;
const fail = (msg) => { failures++; console.log("FAIL " + msg); };

// --- the reported position -------------------------------------------------
// 100 points, field 6R 7R _ 8B 7B, deck R1 R8 B1 B2 B6 Y4. Holding 7R+6R and
// 8B+7B and drawing 8R and 6B pays 100 + 100 = silver on the nose, but only if
// all four are held at once — impossible in a four-wide window.
{
  const all = [];
  for (const c of COLORS) for (const v of VALUES) all.push(c + v);
  const board = ["R6", "R7", null, "B8", "B7"];
  const deck = ["R1", "R8", "B1", "B2", "B6", "Y4"];
  const state = createState();
  state.board = [...board];
  state.score = 100;
  state.log = [{}];
  state.consumed = new Set(all.filter((c) => !deck.includes(c) && !board.includes(c)));

  const o = chestOutlook(state, { cache: createPolicyCache() });
  if (!o.canImprove || o.maxRemaining !== 200) {
    fail(`reported position: expected canImprove with 200 left, got ${o.canImprove} / ${o.maxRemaining}`);
  }
}

// --- randomised: an empty slot must never lose a chest ----------------------
// Play normally, and at every full field also ask the question with one card
// held back, the way the UI sees it a keystroke earlier. A dealt-but-untyped
// card cannot make a reachable chest unreachable.
let checked = 0;
for (let g = 0; g < 120; g++) {
  const state = createState();
  const cache = createPolicyCache();
  let guard = 40;
  while (guard-- > 0) {
    autoFillBoardFromDeck(state, Math.random);
    if (filledCards(state).length < 3) break;
    const full = chestOutlook(state, { cache });
    if (!full.canImprove) break;
    if (deckRemaining(state).length > 0) {
      for (let i = 0; i < BOARD_SIZE; i++) {
        const held = state.board[i];
        if (!held) continue;
        state.board[i] = null;
        const partial = chestOutlook(state, { cache });
        state.board[i] = held;
        checked++;
        if (!partial.canImprove) {
          fail(`slot ${i} empty (${held} not typed yet) called the run finished at ${state.score}` +
               ` — full field says ${full.maxRemaining} still reachable`);
        }
        if (partial.maxRemaining < full.maxRemaining) {
          fail(`slot ${i} empty lowered the ceiling ${full.maxRemaining} -> ${partial.maxRemaining}`);
        }
      }
    }
    const move = suggest(state, { cache });
    if (!move) break;
    if (move.kind === "pick") { confirmPick(state, move.slots); continue; }
    if (deckRemaining(state).length === 0) break;
    discardSlot(state, move.slots[0]);
  }
}
console.log(`partial-field positions checked: ${checked}`);
console.log(failures === 0 ? "OK — an untyped card never costs a chest" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
