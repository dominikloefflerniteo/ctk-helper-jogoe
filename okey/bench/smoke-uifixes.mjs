// The 2026-09-15 edge-case fixes, at the game-state level.
//
// main.js cannot be imported without a DOM, so the UI handlers are not covered
// here — what IS covered is the state machine they drive, which is where the
// damage was done: cards leaving the deck for good, for nothing.
//
//   node bench/smoke-uifixes.mjs

import { createState, addCard, setSlot, discardSlot, confirmPick, scoreHand,
         deckRemaining, ALL_CARD_IDS } from "../game.js";
import { suggestMove } from "../solver.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL: ${name}`);
}

// --- addCard rejects a card already in play ---
{
  const st = createState();
  check("addCard places into slot 0", addCard(st, "R6") === 0);
  check("addCard rejects the same card again", addCard(st, "R6") === -2);
  check("board still holds one R6", st.board.filter((c) => c === "R6").length === 1);
  check("a different card still fits", addCard(st, "R7") === 1);
}
{
  // A consumed card must not come back either.
  const st = createState();
  setSlot(st, 0, "B3");
  discardSlot(st, 0);
  check("addCard rejects a consumed card", addCard(st, "B3") === -2);
  check("consumed card stays out of the deck", !deckRemaining(st).includes("B3"));
}
{
  // The field-full answer must still be distinguishable from the duplicate one.
  const st = createState();
  const ids = ["R1", "R2", "R3", "R4", "R5"];
  for (const id of ids) addCard(st, id);
  check("field full returns -1, not -2", addCard(st, "Y8") === -1);
}

// --- a zero-score pick is never suggested ---
{
  // Five cards with no combination at all and an empty deck: the only "pick"
  // available scores 0, so the solver must decline rather than propose it.
  const st = createState();
  const board = ["R1", "R4", "B2", "Y7", "B6"];
  board.forEach((c, i) => setSlot(st, i, c));
  for (const id of ALL_CARD_IDS) {
    if (!board.includes(id)) st.consumed.add(id);
  }
  check("deck is empty for this test", deckRemaining(st).length === 0);
  const combos = [];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 4; j++) for (let k = j + 1; k < 5; k++) {
    combos.push(scoreHand([board[i], board[j], board[k]]).score);
  }
  check("no combination scores here", Math.max(...combos) === 0);
  const move = suggestMove(st, { policy: "v2" });
  check("solver returns no move rather than a 0-point pick",
    move === null || move.kind !== "pick" || move.score > 0);
}

// --- confirming a scoring pick still works ---
{
  const st = createState();
  ["R6", "R7", "R8", "B1", "Y4"].forEach((c, i) => setSlot(st, i, c));
  const r = confirmPick(st, [0, 1, 2]);
  check("same-colour 6-7-8 scores 100", r.gained === 100);
  check("scored cards leave the deck", !deckRemaining(st).includes("R6"));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
