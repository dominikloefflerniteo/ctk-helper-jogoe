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
import { explainMove } from "../explain.js";
import { setLang, t } from "../i18n.js";

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
    name: "2026-09-08 stream: keep the card that is one draw from 90",
    // The first position of the same run, and one the helper always had right —
    // here to catch an over-correction. R3-R4-R5 is a made 70; B3 is dead (B1
    // and B5 gone) while R7 is one R6 away from a red 5-6-7.
    board: ["R7", "B3", "R4", "R5", "R3"],
    consumed: ["R2", "B1", "B5", "Y2", "Y8"],
    score: 0,
    want: { kind: "discard", cards: ["B3"] },
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

// Mirrors main.js whyText(); kept here so the bench exercises the same path
// the page does.
function reason(state, move) {
  if (move.kind !== "discard") return "";
  const why = explainMove(state, move);
  if (!why) return "";
  const parts = [];
  parts.push(why.dead
    ? t("whyDead", { card: why.thrown })
    : t("whyWeak", { card: why.thrown, max: why.thrownBest }));
  if (why.keep) {
    const cards = why.keepCards.join("+");
    parts.push(why.keepMissing.length === 0
      ? t("whyKeepReady", { cards, score: why.keepScore })
      : t("whyKeep", { cards, missing: why.keepMissing.join("+"), score: why.keepScore }));
  }
  const alt = why.alternative;
  if (alt && alt.kind === "points") parts.push(t("whyAltPoints", { card: alt.cards[0], points: alt.points }));
  else if (alt && alt.kind === "chest") parts.push(t("whyAltChest", { card: alt.cards[0], silver: Math.round(alt.pSilver * 100) + "%" }));
  return parts.join(" ");
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
  // The sentence the player reads. Printed here too, because a reason that
  // contradicts the move is the same failure as a wrong move.
  if (move) {
    for (const lang of ["en", "de"]) {
      setLang(lang);
      console.log(`      [${lang}] ${reason(state, move)}`);
    }
  }
}

console.log("");
console.log(`${CASES.length - failed}/${CASES.length} positions play the right card`);
process.exit(failed === 0 ? 0 : 1);
