// How long does one suggestion take? Decides what can run live in the browser.
import { createState, autoFillBoardFromDeck } from "../game.js";
import { suggestMove } from "../solver.js";
import { suggestMoveRollout } from "../rollout.js";

const state = createState();
autoFillBoardFromDeck(state, Math.random);

function time(label, fn, reps) {
  fn(); // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / reps;
  console.log(`${label.padEnd(26)} ${ms.toFixed(0).padStart(5)} ms/suggestion`);
}

time("v2 heuristic", () => suggestMove(state), 200);
for (const N of [8, 12, 16, 24]) {
  for (const leaf of [0, 8, 10]) {
    time(`rollout N=${N} leaf=${leaf}`, () => suggestMoveRollout(state, { N, exactLeaf: leaf }), 3);
  }
}
