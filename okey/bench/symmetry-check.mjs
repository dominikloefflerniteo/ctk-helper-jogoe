// The colour-symmetry fold must not change a single number.
import { EndgameSolver, maskOf } from "../endgame.js";
import { COLORS, VALUES } from "../game.js";
function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = makeRng(11);
let worst = 0, checked = 0, nodesOn = 0, nodesOff = 0, msOn = 0, msOff = 0;
for (let rep = 0; rep < 12; rep++) {
  const all = [];
  for (const c of COLORS) for (const v of VALUES) all.push(`${c}${v}`);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const cards = all.slice(0, 11);
  const available = maskOf(cards), board = maskOf(cards.slice(0, 5));
  const t0 = Date.now();
  const on = new EndgameSolver({ symmetry: true }).solve(available, board);
  msOn += Date.now() - t0;
  const s1 = new EndgameSolver({ symmetry: true }); s1.solve(available, board); nodesOn += s1.nodes;
  const t1 = Date.now();
  const s2 = new EndgameSolver({ symmetry: false }); const off = s2.solve(available, board);
  msOff += Date.now() - t1; nodesOff += s2.nodes;
  for (let i = 0; i < on.length; i++) { worst = Math.max(worst, Math.abs(on[i] - off[i])); checked++; }
}
console.log(`${checked} curve entries compared, max difference ${worst}`);
console.log(`states: ${nodesOn} with symmetry vs ${nodesOff} without  (${(nodesOff / nodesOn).toFixed(2)}x fewer)`);
console.log(`time:   ${msOn} ms vs ${msOff} ms`);
