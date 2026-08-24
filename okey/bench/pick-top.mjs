// Read a phase's results, rank them, print a table, and write the configs the
// next phase should re-measure with a bigger sample.
//
// Ranking is by the chest objective (silver-or-better + 2x gold), not by
// average score: points are only a means to a chest here.
//
// Usage: node pick-top.mjs --phase 1 --take 9 --next 2

import fs from "node:fs";
import path from "node:path";

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const PHASE = String(arg("phase", "1"));
const TAKE = Number(arg("take", 9));
const NEXT = String(arg("next", String(Number(PHASE) + 1)));
const DIR = path.join(process.cwd(), "okey", "bench");

const file = path.join(DIR, `overnight-phase${PHASE}-results.jsonl`);
if (!fs.existsSync(file)) {
  console.error(`no results for phase ${PHASE}`);
  process.exit(1);
}
const rows = fs.readFileSync(file, "utf8").trim().split("\n")
  .filter(Boolean).map((l) => JSON.parse(l));

rows.sort((a, b) => b.value - a.value);

const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
console.log(`phase ${PHASE}: ${rows.length} configurations, ${rows[0].games} games each`);
console.log("");
console.log("silver+   gold    avg    picks  disc   config");
console.log("-".repeat(96));
for (const r of rows.slice(0, 20)) {
  console.log(
    pct(r.pSilverOrBetter) + "  " + pct(r.pGold) +
    r.mean.toFixed(1).padStart(8) + r.picks.toFixed(2).padStart(8) +
    r.discards.toFixed(2).padStart(7) + "   " + JSON.stringify(r.cfg));
}

// Deduplicate on the config itself, keep the best TAKE.
const seen = new Set();
const top = [];
for (const r of rows) {
  const key = JSON.stringify(r.cfg);
  if (seen.has(key)) continue;
  seen.add(key);
  top.push(r.cfg);
  if (top.length >= TAKE) break;
}

// Always re-measure the current shipping defaults alongside, so the next phase
// answers "is the winner actually better than what we ship", not just "which
// of these looked good once".
const SHIPPING = { policy: "combo", objective: "balanced" };
if (!top.some((c) => JSON.stringify(c) === JSON.stringify(SHIPPING))) top.push(SHIPPING);

const out = path.join(DIR, `overnight-phase${NEXT}-configs.json`);
fs.writeFileSync(out, JSON.stringify(top, null, 2));
console.log(`\nwrote ${top.length} configs to ${path.basename(out)}`);
