// Unattended overnight campaign: screen, then verify on fresh seeds, then
// write the report. One process to schedule, no shell quoting.
//
// Two phases, because a winner picked on one shuffle sequence is usually just
// the config that suits that sequence (iteration 9 learned this the hard way —
// a +3.1pp claim shrank to +1.9pp on fresh seeds):
//
//   screen   every config on seed 1, ranked by gold-weighted chest value
//   verify   the best few, plus the shipping baseline, on seeds it has never
//            seen — this is the only number allowed to justify a change
//
// Everything is bounded by wall clock, and the bound is honoured INSIDE the
// game loop (see overnight.mjs), so the run stops on time with partial results
// rather than overrunning. Results are appended as JSON lines, so a machine
// that goes to sleep still leaves everything finished up to that point.
//
// Usage:
//   node okey/bench/campaign.mjs --screen-until=03:00 --verify-until=08:40
//   node okey/bench/campaign.mjs --shards=9 --screen-games=1500 --verify-games=3500

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const OUT = path.join(process.cwd(), "okey", "bench");
const SHARDS = Number(arg("shards", Math.max(2, Math.min(9, os.cpus().length - 3))));
const SCREEN_GAMES = Number(arg("screen-games", 1500));
const VERIFY_GAMES = Number(arg("verify-games", 3500));
const VERIFY_SEEDS = arg("verify-seeds", "2,3,4,5").split(",").map(Number);
const TOP_K = Number(arg("top", 4));

// "HH:MM" means the next time that clock reads it.
function clockToDate(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}
const SCREEN_UNTIL = clockToDate(arg("screen-until", "03:00"));
const VERIFY_UNTIL = clockToDate(arg("verify-until", "08:40"));

const log = (msg) => {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(OUT, "campaign.log"), line + "\n");
};

// ---------- the search space ----------
//
// Grounded in the 800-game screening of 2026-09-08 rather than spread evenly:
// N=48 was worth +4.7pp silver with gold untouched, N=64 added nothing on top,
// "feasible" was clearly worse and is not here at all. What is still open is how
// the knobs interact — in particular whether more playouts make the noise band
// safe (with 24 playouts a probability steps in units of 4.2%, which is what
// made the band follow noise in the first place).
function screenConfigs() {
  const out = [];
  const push = (o) => out.push({ policy: "combo", exactMaxCards: 12, ...o });

  // The shipping baseline, first so it is never the config that gets cut.
  push({ N: 24, label: "baseline" });

  // How far more playouts carry, with and without reallocation.
  for (const N of [32, 48, 64, 96]) push({ N, label: `n${N}` });
  for (const N of [24, 48, 64, 96]) push({ N, allocate: "halving", label: `n${N}-halving` });

  // A tail that knows what a chest needs, on its own and combined.
  push({ N: 24, base: { thresholdTail: 3 }, label: "tail3" });
  push({ N: 48, base: { thresholdTail: 3 }, label: "n48-tail3" });
  push({ N: 48, allocate: "halving", base: { thresholdTail: 3 }, label: "n48-halving-tail3" });
  push({ N: 64, allocate: "halving", base: { thresholdTail: 3 }, label: "n64-halving-tail3" });

  // Does resolution rescue the band? It bought silver and cost gold at N=24.
  push({ N: 48, tieZ: 1.0, label: "n48-band" });
  push({ N: 48, allocate: "halving", tieZ: 1.0, label: "n48-halving-band" });

  // One objective instead of the 10%-of-24-playouts switch.
  push({ N: 48, objective: "balanced", label: "n48-balanced" });
  push({ N: 48, allocate: "halving", objective: "balanced", label: "n48-halving-balanced" });

  // The correctness fix rides along on the strongest allocation: it costs no
  // measurable rate but makes the closing turns provably right.
  push({ N: 48, allocate: "halving", exactMaxCards: 13, label: "n48-halving-exact13" });
  return out;
}

// overnight.mjs parses its --deadline with `new Date(string)`, and a string
// without a zone is read as LOCAL time. Handing it toISOString() therefore
// shifts the deadline by the UTC offset — in CEST that is two hours early, and
// the smoke test duly showed every shard "stopping early: -76 min left" and
// recording zero games. Format it local.
function localStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function runShards(phase, games, seed, deadline) {
  const stamp = localStamp(deadline);
  const kids = [];
  for (let sh = 0; sh < SHARDS; sh++) {
    const kid = spawn(process.execPath, [
      "okey/bench/overnight.mjs",
      "--shard", String(sh), "--of", String(SHARDS),
      "--phase", String(phase), "--games", String(games),
      "--seed", String(seed), "--deadline", stamp,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    kid.stdout.on("data", (d) => process.stdout.write(d));
    kid.stderr.on("data", (d) => process.stderr.write(d));
    kids.push(new Promise((res) => kid.on("exit", res)));
  }
  return Promise.all(kids);
}

const readResults = (phase) => {
  const f = path.join(OUT, `overnight-phase${phase}-results.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

// ---------- run ----------
(async () => {
  fs.writeFileSync(path.join(OUT, "overnight-phase10-configs.json"), JSON.stringify(screenConfigs(), null, 1));
  fs.writeFileSync(path.join(OUT, "overnight-phase10-results.jsonl"), "");
  log(`campaign start — ${SHARDS} shards on ${os.cpus().length} cores`);
  log(`screen: ${screenConfigs().length} configs x ${SCREEN_GAMES} games, seed 1, until ${SCREEN_UNTIL.toLocaleTimeString()}`);

  await runShards(10, SCREEN_GAMES, 1, SCREEN_UNTIL);

  // Rank on the currency the solver itself uses, and only trust configs that
  // actually finished the games they were given.
  const screened = readResults(10).filter((r) => r.games >= SCREEN_GAMES * 0.9);
  screened.sort((a, b) => b.value - a.value);
  log(`screen done: ${screened.length} configs completed`);
  for (const r of screened) {
    log(`  ${(r.cfg.label || "?").padEnd(22)} silver+ ${(r.pSilverOrBetter * 100).toFixed(1)}%  gold ${(r.pGold * 100).toFixed(1)}%  avg ${r.mean.toFixed(1)}  value ${r.value.toFixed(3)}`);
  }

  // The baseline always goes through to verification — without it the fresh-seed
  // numbers have nothing to be compared against.
  const winners = [];
  const base = screened.find((r) => r.cfg.label === "baseline");
  if (base) winners.push(base.cfg);
  for (const r of screened) {
    if (winners.length >= TOP_K + 1) break;
    if (r.cfg.label !== "baseline") winners.push(r.cfg);
  }
  fs.writeFileSync(path.join(OUT, "overnight-phase11-configs.json"), JSON.stringify(winners, null, 1));
  fs.writeFileSync(path.join(OUT, "overnight-phase11-results.jsonl"), "");
  log(`verify: ${winners.map((c) => c.label).join(", ")} on seeds ${VERIFY_SEEDS.join(",")} x ${VERIFY_GAMES} games, until ${VERIFY_UNTIL.toLocaleTimeString()}`);

  // Seeds run one after another so a stopped campaign still has whole seeds
  // rather than a fragment of each.
  for (const seed of VERIFY_SEEDS) {
    if (Date.now() > VERIFY_UNTIL.getTime()) { log(`out of time before seed ${seed}`); break; }
    log(`verify seed ${seed}`);
    await runShards(11, VERIFY_GAMES, seed, VERIFY_UNTIL);
  }

  // ---------- report ----------
  const pooled = new Map();
  for (const r of readResults(11)) {
    const k = r.cfg.label || JSON.stringify(r.cfg);
    const acc = pooled.get(k) || { games: 0, silver: 0, gold: 0, score: 0, seeds: new Set() };
    acc.games += r.games;
    acc.silver += r.pSilverOrBetter * r.games;
    acc.gold += r.pGold * r.games;
    acc.score += r.mean * r.games;
    acc.seeds.add(r.seed);
    pooled.set(k, acc);
  }
  const lines = [];
  lines.push(`# Okey overnight campaign — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Screened ${screened.length} configs on seed 1, verified the best ${winners.length} on fresh seeds.`);
  lines.push("Fresh-seed numbers are the only ones that may justify a change.");
  lines.push("");
  lines.push("| config | games | seeds | silver+ | 95% | gold | avg |");
  lines.push("|---|---|---|---|---|---|---|");
  const rows = [...pooled.entries()].map(([k, a]) => {
    const s = a.silver / a.games;
    const err = 1.96 * Math.sqrt((s * (1 - s)) / a.games) * 100;
    return { k, a, s, err };
  }).sort((x, y) => (y.s + 2 * y.a.gold / y.a.games) - (x.s + 2 * x.a.gold / x.a.games));
  for (const { k, a, s, err } of rows) {
    lines.push(`| ${k} | ${a.games} | ${[...a.seeds].sort().join(",")} | ${(s * 100).toFixed(1)}% | ±${err.toFixed(1)} | ${(a.gold / a.games * 100).toFixed(1)}% | ${(a.score / a.games).toFixed(1)} |`);
  }
  lines.push("");
  const baseRow = rows.find((r) => r.k === "baseline");
  if (baseRow && rows[0] && rows[0].k !== "baseline") {
    const w = rows[0];
    const dS = (w.s - baseRow.s) * 100;
    const dG = (w.a.gold / w.a.games - baseRow.a.gold / baseRow.a.games) * 100;
    lines.push(`Best: **${w.k}** — silver+ ${dS >= 0 ? "+" : ""}${dS.toFixed(1)}pp, gold ${dG >= 0 ? "+" : ""}${dG.toFixed(1)}pp against the shipping baseline on the same decks.`);
    lines.push("");
    lines.push(dG < -0.3
      ? "WARNING: gold is down. That is the trade that got the 2026-09-08 change rolled back — do not ship this without a decision about it."
      : "Gold is not down, which is the condition the 2026-09-08 rollback set for shipping anything here.");
  }
  fs.writeFileSync(path.join(OUT, "overnight-report.md"), lines.join("\n") + "\n");
  log("report written to okey/bench/overnight-report.md");
  log("campaign done");
})();
