// The strong search, off the main thread.
//
// The helper always answered instantly — the v2 heuristic paints in ~0.1 ms and
// the full search replaced it a moment later from a setTimeout. That was fine
// while the full search cost ~40 ms. It stops being fine as the search gets
// stronger: a setTimeout still runs on the main thread, so a 400 ms search is
// 400 ms in which a click does not land. "Off the click path" is not the same
// as "out of the way".
//
// Here the search runs in its own thread. The page stays responsive at any
// search cost, which is what makes N=96 (and, later, a wider exact window)
// affordable at all.
//
// Two things this file must keep doing:
//
//   1. Hold the per-game solver table. The exact endgame table stays valid for
//      a whole game (every later position is a sub-position of the first), and
//      rebuilding it per request would cost far more than the search. It is
//      dropped on "reset", i.e. a new game.
//   2. Send back only what the UI reads. A finished search carries the raw
//      per-playout sample arrays — hundreds of kilobytes that structured-clone
//      would faithfully copy across the thread boundary for nothing.

import { createState } from "./game.js";
import { suggest, chestOutlook, createPolicyCache } from "./policy.js";

let cache = createPolicyCache();

// The UI's contract with a suggestion: kind/slots/cards drive the highlight,
// score/type/label the text, and the odds line reads exact or rollout stats.
// Everything else stays in this thread.
function slim(move) {
  if (!move) return null;
  const out = {
    kind: move.kind,
    slots: move.slots,
    cards: move.cards,
    score: move.score,
    type: move.type,
    label: move.label,
    reasoning: move.reasoning,
  };
  if (move.exact) out.exact = { pSilver: move.exact.pSilver, pGold: move.exact.pGold };
  if (move.rollout && move.rollout.stats) {
    const s = move.rollout.stats;
    out.rollout = { stats: { pSilver: s.pSilver, pGold: s.pGold, mean: s.mean } };
  }
  return out;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "reset") {
    cache = createPolicyCache();
    return;
  }
  if (msg.type !== "search") return;

  // Rebuild the position from plain data — the worker never shares state with
  // the page, it is handed a snapshot and answers about exactly that snapshot.
  const state = createState();
  state.board = msg.board;
  state.score = msg.score;
  state.consumed = new Set(msg.consumed);

  let move = null;
  let outlook = null;
  try {
    move = suggest(state, { ...(msg.options || {}), cache });
    // The end-of-run check needs the same exact table this search just built,
    // and it is the one other place that can trigger a full solve. Computing it
    // here costs nothing extra and keeps the main thread free of the only other
    // expensive call in the app.
    outlook = chestOutlook(state, { cache });
  } catch (err) {
    // A failed search must not silently freeze the answer on screen: the page
    // keeps the heuristic suggestion it already has and logs why.
    self.postMessage({ type: "error", key: msg.key, message: String(err && err.message || err) });
    return;
  }
  // The key travels back untouched so the page can drop an answer to a position
  // the player has already moved on from.
  self.postMessage({ type: "result", key: msg.key, move: slim(move), outlook });
};
