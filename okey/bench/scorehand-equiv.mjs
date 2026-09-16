// scoreHand became a lookup table on 2026-09-15 (it was 20% of all search
// time). A speed change to a scoring function is only safe if it is EXACTLY
// the old function — a single differing combo would silently change play
// everywhere, and no rate benchmark would tell you which change caused it.
//
// So this does not sample: it compares the new implementation against a
// verbatim copy of the old one over ALL 24^3 ordered triples, including the
// degenerate duplicate-card inputs the board should never hold but which the
// keyboard path could once produce.
//
//   node bench/scorehand-equiv.mjs

import { scoreHand, COLORS, VALUES, cardId, parseCardId,
         scoreThreeOfAKind, scoreSameColorSeq, scoreMixedSeq } from "../game.js";

// --- the implementation as it stood before the table, copied verbatim ---
function scoreHandOld(cards) {
  if (!cards || cards.length !== 3) return { score: 0, type: "none", label: "—" };
  const parsed = cards.map(parseCardId);
  const values = parsed.map((c) => c.value).sort((a, b) => a - b);
  const colors = parsed.map((c) => c.color);

  if (values[0] === values[1] && values[1] === values[2]) {
    const v = values[0];
    return { score: scoreThreeOfAKind(v), type: "three", label: `Three ${v}s` };
  }

  const isSeq = values[1] === values[0] + 1 && values[2] === values[1] + 1;
  if (isSeq) {
    const low = values[0];
    const allSameColor = colors[0] === colors[1] && colors[1] === colors[2];
    if (allSameColor) {
      return { score: scoreSameColorSeq(low), type: "sameSeq", label: `${low}-${low + 1}-${low + 2} same color` };
    }
    return { score: scoreMixedSeq(low), type: "mixedSeq", label: `${low}-${low + 1}-${low + 2} mixed` };
  }

  return { score: 0, type: "none", label: "No combo" };
}

const all = [];
for (const c of COLORS) for (const v of VALUES) all.push(cardId(c, v));

let checked = 0, bad = 0;
for (const a of all) {
  for (const b of all) {
    for (const c of all) {
      const got = scoreHand([a, b, c]);
      const want = scoreHandOld([a, b, c]);
      checked++;
      if (got.score !== want.score || got.type !== want.type || got.label !== want.label) {
        if (bad < 5) {
          console.error(`MISMATCH ${a},${b},${c}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
        }
        bad++;
      }
    }
  }
}

// Malformed and short input must behave as before too.
for (const cards of [null, undefined, [], ["R1"], ["R1", "R2"], ["R1", "R2", "R3", "R4"], ["ZZ", "R2", "R3"]]) {
  const got = scoreHand(cards);
  const want = cards && cards.length === 3 ? scoreHandOld(cards) : scoreHandOld(cards);
  checked++;
  // The unknown-id case is the one deliberate difference in reasoning (the old
  // code would parse "ZZ" to NaN and fall through to "No combo"); assert that
  // the ANSWER still matches even though the route differs.
  if (got.score !== want.score || got.type !== want.type) {
    console.error(`MISMATCH on ${JSON.stringify(cards)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    bad++;
  }
}

console.log(`${checked} inputs checked, ${bad} mismatches`);
process.exit(bad === 0 ? 0 : 1);
