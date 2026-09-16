// Rank the results of one tuning phase and write the next phase's config file.
//
//   node bench/tune-select.mjs --tag goldmin --from 1 --to 2 --top 4
//
// Ranking is silver-or-better first, gold as the tiebreak — deliberately NOT
// the two summed. A summed score hides the config that buys 1pp of gold with
// 3pp of silver, which is exactly the trade this campaign exists to avoid
// making by accident.
//
// The currently shipping config is always appended to the survivors, so every
// later phase measures the challenger against the incumbent on the same decks
// rather than against a number from an older run.

import fs from "node:fs";
import path from "node:path";
import { AUTO_GOLD_MIN } from "../rollout.js";

const OUT_DIR = path.join(process.cwd(), "okey", "bench");

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const TAG = String(arg("tag", "goldmin"));
const FROM = String(arg("from", "1"));
const TO = String(arg("to", "2"));
const TOP = Number(arg("top", 4));

// What the helper ships with today. Carried through every phase as the control.
const SHIPPING = {
  policy: "combo", objective: "auto", exactMaxCards: 13,
  N: 96, goldMin: AUTO_GOLD_MIN, heuristic: "base",
};

const label = (c) => `${(c.heuristic ?? "base").padEnd(7)} N=${String(c.N).padEnd(4)} goldMin=${c.goldMin}`;

const src = path.join(OUT_DIR, `${TAG}-phase${FROM}-results.jsonl`);
if (!fs.existsSync(src)) {
  console.error(`[select] no results at ${src} — phase ${FROM} produced nothing`);
  process.exit(1);
}

const rows = fs.readFileSync(src, "utf8").trim().split("\n")
  .filter(Boolean).map((l) => JSON.parse(l));

// A config stopped by the deadline reports how many games it actually played.
// Judging a 180-game sample against a 1000-game one would promote whichever
// config happened to be interrupted in a lucky spot, so short runs are dropped.
const full = rows.filter((r) => r.games >= r.requested * 0.8);
const dropped = rows.length - full.length;
if (dropped > 0) console.log(`[select] ignoring ${dropped} config(s) cut short by the deadline`);
if (full.length === 0) {
  console.error("[select] every config was cut short — nothing to rank");
  process.exit(1);
}

full.sort((a, b) => b.pSilverOrBetter - a.pSilverOrBetter || b.pGold - a.pGold);

console.log(`[select] phase ${FROM}: ${full.length} full configs, top ${Math.min(TOP, full.length)}:`);
for (const r of full.slice(0, TOP)) {
  console.log(`  ${label(r.cfg)}  silver+ ${(r.pSilverOrBetter * 100).toFixed(1)}%  gold ${(r.pGold * 100).toFixed(1)}%  avg ${r.mean.toFixed(1)}  (${r.games} games)`);
}

const survivors = full.slice(0, TOP).map((r) => r.cfg);
const isShipping = (c) => c.N === SHIPPING.N && c.goldMin === SHIPPING.goldMin
  && (c.heuristic ?? "base") === "base";
if (!survivors.some(isShipping)) survivors.push(SHIPPING);

const dest = path.join(OUT_DIR, `${TAG}-phase${TO}-configs.json`);
fs.writeFileSync(dest, JSON.stringify(survivors, null, 2));
console.log(`[select] wrote ${survivors.length} configs (incl. the shipping control) -> ${path.basename(dest)}`);
