// Overnight parameter search.
//
// Every knob in the shipping policy was tuned one at a time with the others
// held fixed. Such optima move when the knobs are varied together, and that is
// exactly what idle machine time is for. This runs many configurations against
// the SAME deck orders (paired comparison) and appends one JSON line per
// finished configuration, so partial results survive an interruption.
//
// Usage:
//   node overnight.mjs --shard 0 --of 9 --phase 1 --games 250 --deadline 2026-08-24T05:30
//
// A shard takes every config where (index % of) === shard. Nothing is shared
// between processes except the results file, which is only ever appended to.
//
// The deadline is a hard stop: a config is only STARTED if there is plausibly
// time to finish it, so the whole fleet is guaranteed to be done before the
// wall-clock limit rather than killed mid-run.

import fs from "node:fs";
import path from "node:path";
import {
  createState, confirmPick, discardSlot, autoFillBoardFromDeck,
  deckRemaining, filledCards, chestForScore, CHEST_THRESHOLDS,
} from "../game.js";
import { suggest, createPolicyCache } from "../policy.js";
import { suggestMove } from "../solver.js";
import { suggestMoveRollout } from "../rollout.js";

const OUT_DIR = path.join(process.cwd(), "okey", "bench");

// ---------- args ----------
function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SHARD = Number(arg("shard", 0));
const OF = Number(arg("of", 1));
const PHASE = String(arg("phase", "1"));
const GAMES = Number(arg("games", 250));
const SEED = Number(arg("seed", 1));
const DEADLINE = new Date(arg("deadline", "2099-01-01T00:00")).getTime();

// ---------- rng ----------
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- one game ----------
function playOneGame(rand, cfg) {
  const state = createState();
  const cache = cfg.policy === "combo" ? createPolicyCache() : null;
  let picks = 0, discards = 0, safety = 60;

  while (safety-- > 0) {
    autoFillBoardFromDeck(state, rand);
    if (filledCards(state).length < 3) break;

    const move = cfg.policy === "combo" ? suggest(state, { ...cfg, cache })
      : cfg.policy === "rollout" ? suggestMoveRollout(state, cfg)
      : suggestMove(state, cfg);
    if (!move) break;

    if (move.kind === "discard") {
      if (deckRemaining(state).length === 0) {
        const forced = suggestMove(state, { policy: "v1", opportunityCost: Infinity });
        if (!forced || forced.kind !== "pick") break;
        confirmPick(state, forced.slots); picks++;
        continue;
      }
      discardSlot(state, move.slots[0]); discards++;
      continue;
    }
    confirmPick(state, move.slots); picks++;
  }
  return { score: state.score, picks, discards, chest: chestForScore(state.score) };
}

// `deadline` is checked INSIDE the loop, not only before starting a config.
// Last night's run overran its window by hours because a single config could
// not be interrupted once begun; a partial result with a recorded game count
// is far better than a missed deadline.
function runConfig(cfg, games, seed, deadline = Infinity) {
  const rand = makeRng(seed);
  let sum = 0, gold = 0, silver = 0, picks = 0, disc = 0, sumSq = 0;
  const t0 = Date.now();
  let played = 0;
  for (let i = 0; i < games; i++) {
    if ((i & 63) === 0 && Date.now() > deadline) break;
    played++;
    const r = playOneGame(rand, cfg);
    sum += r.score; sumSq += r.score * r.score;
    if (r.chest === "gold") gold++;
    else if (r.chest === "silver") silver++;
    picks += r.picks; disc += r.discards;
  }
  const requested = games;
  games = played || 1;
  const mean = sum / games;
  return {
    cfg, games, seed, requested,
    mean,
    sd: Math.sqrt(Math.max(0, sumSq / games - mean * mean)),
    pGold: gold / games,
    pSilver: silver / games,          // silver band only (gold counted separately)
    pSilverOrBetter: (gold + silver) / games,
    picks: picks / games,
    discards: disc / games,
    // the objective everything is ranked by: gold counts triple overall
    value: (gold + silver) / games + 2 * (gold / games),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

// ---------- the search space ----------
//
// Phase 1 is a coarse spread over every knob at once. It is deliberately not a
// full grid (that would be ~600 configs): the values below cover the plausible
// range of each knob while varying the others, which is what catches optima
// that single-knob tuning misses.
function phase1Configs() {
  const out = [];
  const push = (o) => out.push({ policy: "combo", objective: "balanced", ...o });

  // main sweep: N x leaf x exact cutoff
  for (const N of [8, 12, 16, 24, 32]) {
    for (const exactLeaf of [0, 6, 8, 10]) {
      for (const exactMaxCards of [10, 12, 13]) {
        push({ N, exactLeaf, exactMaxCards });
      }
    }
  }
  // lambda of the heuristic that drives the playouts. It has to travel as
  // `base`, because that is the options object the rollout hands to the
  // heuristic — passing it at the top level would silently do nothing.
  for (const lambda of [3, 4, 6, 8, 12]) {
    for (const N of [16, 24]) {
      push({ N, exactLeaf: 8, exactMaxCards: 12, base: { lambda } });
    }
  }
  // objective variants
  for (const objective of ["silver", "gold", "points", "auto"]) {
    for (const N of [16, 24]) push({ N, exactLeaf: 8, exactMaxCards: 12, objective });
  }
  // references
  push({ policy: "rollout", N: 16, exactLeaf: 0 });
  push({ policy: "v2", lambda: 6 });
  return out;
}

// Phase 2/3 read their configs from a file written by the driver.
function fileConfigs(name) {
  const p = path.join(OUT_DIR, name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const configs = PHASE === "1" ? phase1Configs() : fileConfigs(`overnight-phase${PHASE}-configs.json`);
const mine = configs.filter((_, i) => i % OF === SHARD);
const resultsFile = path.join(OUT_DIR, `overnight-phase${PHASE}-results.jsonl`);

// Time budget: refuse to start a config that probably cannot finish. The first
// one is measured, then the estimate is the running average per config.
let spent = 0, done = 0;
console.log(`[shard ${SHARD}/${OF}] phase ${PHASE}: ${mine.length} configs, ${GAMES} games each, deadline ${new Date(DEADLINE).toLocaleString()}`);

for (const cfg of mine) {
  const avg = done > 0 ? spent / done : 0;
  const left = DEADLINE - Date.now();
  if (done > 0 && left < avg * 1.15) {
    console.log(`[shard ${SHARD}] stopping early: ${Math.round(left / 60000)} min left, a config takes ~${Math.round(avg / 60000)} min`);
    break;
  }
  const t0 = Date.now();
  const res = runConfig(cfg, GAMES, SEED, DEADLINE);
  spent += Date.now() - t0; done++;
  fs.appendFileSync(resultsFile, JSON.stringify(res) + "\n");
  console.log(`[shard ${SHARD}] ${JSON.stringify(cfg)} -> silver+ ${(res.pSilverOrBetter * 100).toFixed(1)}% gold ${(res.pGold * 100).toFixed(1)}% avg ${res.mean.toFixed(1)} (${res.seconds}s)`);
}

fs.writeFileSync(path.join(OUT_DIR, `overnight-phase${PHASE}-shard${SHARD}.done`), String(done));
console.log(`[shard ${SHARD}] finished ${done}/${mine.length} configs`);
