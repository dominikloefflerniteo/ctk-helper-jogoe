// The way people actually play right now: click through fast, chase only the
// 100-point same-colour 6-7-8, bin everything else.
//
// Rules as described:
//   1. same-colour 6-7-8 on the field -> take it (100 pts)
//   2. otherwise throw any card that is not a 6, 7 or 8 and redraw
//   3. field is nothing but 6/7/8 and no run can be completed -> stop the run
//
// Variants measured alongside it, because the exact stopping rule matters:
//   "strict"   stop as described
//   "trim"     when stuck, throw the most redundant 6/7/8 instead of stopping
//   "cash"     when stuck, take the best hand on the field instead of stopping
//
// Usage: node bench/human-baseline.mjs [games]

import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck, deckRemaining,
  filledCards, parseCardId, scoreHand, chestForScore, COLORS,
} from "../game.js";
import { rankCombos } from "../solver.js";

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TARGET = [6, 7, 8];
const isTarget = (id) => TARGET.includes(parseCardId(id).value);

// Slots of a complete same-colour 6-7-8, or null.
function findRun(board) {
  for (const c of COLORS) {
    const slots = TARGET.map((v) => board.indexOf(`${c}${v}`));
    if (slots.every((s) => s >= 0)) return slots;
  }
  return null;
}

// Which 6/7/8 is the most redundant: the one whose colour is furthest from
// completing, counting only cards still obtainable.
function mostRedundant(board, deck) {
  const alive = new Set([...deck, ...board.filter(Boolean)]);
  let worst = -1, worstScore = Infinity;
  for (let i = 0; i < board.length; i++) {
    const id = board[i];
    if (!id) continue;
    const { color } = parseCardId(id);
    // How many of this colour's 6/7/8 are still gettable at all?
    const reachable = TARGET.filter((v) => alive.has(`${color}${v}`)).length;
    const held = TARGET.filter((v) => board.includes(`${color}${v}`)).length;
    const s = reachable * 10 + held;
    if (s < worstScore) { worstScore = s; worst = i; }
  }
  return worst;
}

function playOneGame(rand, variant) {
  const state = createState();
  let picks = 0, discards = 0, stopped = false;
  let safety = 60;

  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;

    const run = findRun(state.board);
    if (run) { confirmPick(state, run); picks++; continue; }

    const deck = deckRemaining(state);
    const junk = state.board.findIndex((c) => c && !isTarget(c));
    if (junk >= 0 && deck.length > 0) { discardSlot(state, junk); discards++; continue; }

    // Stuck: only 6/7/8 on the field (or the deck is dry) and no run.
    if (variant === "strict") { stopped = true; break; }
    if (variant === "cash") {
      const best = rankCombos(state.board)[0];
      if (best && best.score > 0) { confirmPick(state, best.slots); picks++; continue; }
      stopped = true; break;
    }
    if (deck.length === 0) {
      const best = rankCombos(state.board)[0];
      if (best && best.score > 0) { confirmPick(state, best.slots); picks++; continue; }
      stopped = true; break;
    }
    const drop = mostRedundant(state.board, deck);
    if (drop < 0) { stopped = true; break; }
    discardSlot(state, drop);
    discards++;
  }
  return { score: state.score, picks, discards, stopped };
}

const games = Number(process.argv[2] || 20000);
console.log(`"only 6-7-8" human baseline — ${games} games/variant, seed 1`);
console.log("");
console.log("variant   avg score   gold   silver   bronze   runs made   discards   stopped early");
console.log("-".repeat(88));
for (const variant of ["strict", "trim", "cash"]) {
  const rand = makeRng(1);
  let sum = 0, gold = 0, silver = 0, picks = 0, disc = 0, stopped = 0;
  const runsHist = new Map();
  for (let i = 0; i < games; i++) {
    const r = playOneGame(rand, variant);
    sum += r.score;
    const chest = chestForScore(r.score);
    if (chest === "gold") gold++;
    if (chest === "gold" || chest === "silver") silver++;
    picks += r.picks; disc += r.discards; if (r.stopped) stopped++;
    runsHist.set(r.picks, (runsHist.get(r.picks) || 0) + 1);
  }
  const pct = (x) => (x / games * 100).toFixed(1).padStart(6) + "%";
  console.log(
    variant.padEnd(9) + (sum / games).toFixed(1).padStart(10) +
    pct(gold) + pct(silver - gold) + pct(games - silver) +
    (picks / games).toFixed(2).padStart(11) + (disc / games).toFixed(2).padStart(11) +
    pct(stopped));
  if (variant === "strict") {
    const keys = [...runsHist.keys()].sort((a, b) => a - b);
    console.log("          runs completed per game: " +
      keys.map((k) => `${k}x: ${(runsHist.get(k) / games * 100).toFixed(1)}%`).join("   "));
  }
}
