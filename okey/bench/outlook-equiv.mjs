// The gap in my first equivalence check: it only compared FULL boards.
//
// chestOutlook has a second path for boards with holes the deck can still fill
// (valueAfterFill, added 2026-08-31), and that is exactly the path the false
// "nothing more possible" overlay came from. If the optimisations disturbed
// anything, this is where it would show.
//
// Walks seeded games and, at every position, compares old vs new with each
// single card removed from the board as well as with the board intact.

import { createState, confirmPick, discardSlot, autoFillBoardFromDeck,
         deckRemaining, filledCards, setSlot } from "../game.js";
import { suggest, createPolicyCache, chestOutlook as outNew }
  from "../policy.js";

// The baseline to compare against is a checkout of the code BEFORE the change
// under test, so its location is an argument rather than a fixed path:
//
//   mkdir -p /tmp/base && git -C <repo> show <ref>:okey/game.js > ... etc
//   node bench/outlook-equiv.mjs 40 /tmp/base/okey
//
// Left out of the overnight release gate for exactly this reason: it needs a
// second copy of the tree that the gate cannot assume exists.
const BASE_DIR = process.argv[3] || process.env.OKEY_BASELINE_DIR;
if (!BASE_DIR) {
  console.error("usage: node bench/outlook-equiv.mjs [games] <path-to-baseline-okey-dir>");
  console.error("       (or set OKEY_BASELINE_DIR)");
  process.exit(2);
}
const { pathToFileURL } = await import("node:url");
const { chestOutlook: outOld } =
  await import(pathToFileURL(`${BASE_DIR}/policy.js`).href);

function rng(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAMES = Number(process.argv[2] || 40);
let positions = 0, diffs = 0;

function compare(st, what) {
  const a = outNew(st, {});
  const b = outOld(st, {});
  positions++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    if (diffs < 6) {
      console.error(`DIFF (${what}) board=${st.board} score=${st.score}`);
      console.error(`  new ${JSON.stringify(a)}`);
      console.error(`  old ${JSON.stringify(b)}`);
    }
    diffs++;
  }
}

for (let g = 0; g < GAMES; g++) {
  const rand = rng(5000 + g);
  const st = createState();
  const cache = createPolicyCache();
  let safety = 60;
  while (safety-- > 0) {
    autoFillBoardFromDeck(st, rand);
    if (filledCards(st).length < 3) break;

    compare(st, "full board");

    // The partial-field path: one card not yet typed in.
    for (let s = 0; s < st.board.length; s++) {
      const held = st.board[s];
      if (!held) continue;
      st.board[s] = null;
      compare(st, `hole at slot ${s}`);
      st.board[s] = held;
    }

    const m = suggest(st, { policy: "combo", objective: "auto", N: 16, cache });
    if (!m) break;
    if (m.kind === "discard") {
      if (deckRemaining(st).length === 0) break;
      discardSlot(st, m.slots[0]);
      continue;
    }
    confirmPick(st, m.slots);
  }
}

console.log(`${positions} positions compared (full + partial) across ${GAMES} seeded games, ${diffs} differences`);
process.exit(diffs === 0 ? 0 : 1);
