// Pool the fresh-seed results per configuration and print the comparison.
import fs from "node:fs";
const rows = fs.readFileSync("okey/bench/overnight-phase5-results.jsonl", "utf8")
  .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byCfg = new Map();
for (const r of rows) {
  const key = JSON.stringify(r.cfg);
  const acc = byCfg.get(key) || { games: 0, silver: 0, gold: 0, score: 0, seeds: [] };
  acc.games += r.games;
  acc.silver += r.pSilverOrBetter * r.games;
  acc.gold += r.pGold * r.games;
  acc.score += r.mean * r.games;
  acc.seeds.push(r.seed);
  byCfg.set(key, acc);
}
console.log("");
console.log("pooled over fresh seeds (never used for ranking)");
console.log("games   silver+   gold     avg    seeds   config");
console.log("-".repeat(92));
for (const [key, a] of byCfg) {
  const s = a.silver / a.games, g = a.gold / a.games;
  // 95% interval for the silver rate
  const err = 1.96 * Math.sqrt(s * (1 - s) / a.games) * 100;
  console.log(
    String(a.games).padStart(6) +
    ((s * 100).toFixed(1) + "%").padStart(9) + " +-" + err.toFixed(1) +
    ((g * 100).toFixed(1) + "%").padStart(7) +
    (a.score / a.games).toFixed(1).padStart(8) +
    "   " + a.seeds.sort().join(",") + "   " + key);
}
