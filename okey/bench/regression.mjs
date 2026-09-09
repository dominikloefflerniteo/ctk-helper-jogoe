// Positions the helper once got wrong, with the move it must play.
//
// Every case here comes from a real screenshot, not from a generator: a user
// looked at the advice, doubted it, and was right. Chest rates over thousands of
// games cannot catch these — a single inverted answer moves the average by
// nothing at all, but it is exactly the answer that costs the helper its
// credibility.
//
// `want` is what optimal play does, established independently of the code path
// under test (see each case's note). Run after touching solver/rollout/policy:
//
//   node bench/regression.mjs

import { createState, COLORS, VALUES } from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";

const ALL = [];
for (const c of COLORS) for (const v of VALUES) ALL.push(`${c}${v}`);

const CASES = [
  {
    name: "2026-09-08 stream: B3 has partners, R3 has none",
    // 13 cards in play, so this used to miss the exact window by one card and
    // fall to the rollout. Exact evaluation of every discard, silver needing
    // 180: R3 and B1 and B3 all reach silver with certainty, but the expected
    // remaining points are R3 206.2, B1 202.9, B3 183.3 — the heuristic tail
    // rated B3 higher (87.0% vs 73.5% of playouts) and threw the 23 points.
    board: ["R3", "B4", "B1", "R6", "B3"],
    deck: ["R2", "R7", "R8", "B2", "B5", "B6", "Y5", "Y7"],
    score: 126,
    want: { kind: "discard", cards: ["R3"] },
  },
  {
    name: "2026-09-08 stream: 1-2-3 is possible and worthless",
    // Chat objected that 1-2-3 was still on. It is — mixed, for 10 points, and
    // it would eat the Y2+Y3 already sitting in a made yellow 2-3-4 worth 60.
    // Too big to solve exactly (20 cards); the rollout is the authority here and
    // this case guards it against drifting into the chat's answer.
    board: ["R1", "Y4", "Y3", "Y2", "B3"],
    consumed: ["R4", "R5", "B8", "Y1"],
    score: 120,
    want: { kind: "discard", cards: ["R1"] },
  },
  {
    name: "2026-09-08 stream: bank the made 70, do not fish for the 90",
    // A case that was recorded with the WRONG expected move, and is kept as a
    // warning about how that happened.
    //
    // The helper said "throw B3" and it was easy to justify: B3 is dead (B1 and
    // B5 are gone) while R7 is one R6 away from a red 5-6-7 worth 90. Both facts
    // are true, and the conclusion still does not follow.
    //
    // 20 cards are in play, so no exact solver reaches this. Settled instead by
    // an oracle rollout of 4000 playouts per candidate — far past anything a
    // live search can afford, all candidates on the same deck orders:
    //
    //   pick R4+R5+R3   41.3% silver   2.9% gold   E 295.5
    //   discard B3      37.4% silver   0.0% gold   E 290.2
    //
    // Taking the made 70 now is the only line that keeps gold alive at all. The
    // lesson is not about this board: an explanation that sounds right is not
    // evidence, and a test whose expectation comes from the engine it is testing
    // only locks in whatever that engine already believed.
    board: ["R7", "B3", "R4", "R5", "R3"],
    consumed: ["R2", "B1", "B5", "Y2", "Y8"],
    score: 0,
    want: { kind: "pick", cards: ["R4", "R5", "R3"] },
  },
];

function build(c) {
  const state = createState();
  state.board = [...c.board];
  state.score = c.score;
  const consumed = c.consumed
    ?? ALL.filter((id) => !c.board.includes(id) && !c.deck.includes(id));
  for (const id of consumed) state.consumed.add(id);
  return state;
}

let failed = 0;
for (const c of CASES) {
  const state = build(c);
  const move = suggest(state, { cache: createPolicyCache() });
  const got = move ? `${move.kind} ${move.cards.join("+")}` : "none";
  const want = `${c.want.kind} ${c.want.cards.join("+")}`;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}`);
  console.log(`      field ${c.board.join(" ")} @${c.score} -> ${got}${ok ? "" : `   (want ${want})`}`);
  if (move && move.reasoning) console.log(`      ${move.reasoning}`);
}

console.log("");
console.log(`${CASES.length - failed}/${CASES.length} positions play the right card`);
process.exit(failed === 0 ? 0 : 1);
