#!/usr/bin/env bash
# Overnight tuning campaign. Window 01:00 -> 10:00, run by the Windows task
# "OkeyTune".
#
# 2026-09-15 campaign: find the best configuration that STAYS INSIDE THE
# LATENCY BUDGET. Three axes, varied together:
#
#   heuristic  base vs flavius (typeMul + residual synergy + lambda 10)
#   N          96 (shipping, 350 ms p90) vs 160 (515 ms p90)
#   goldMin    0.02 / 0.06 / 0.10
#
# N=240 -- m2-helper's budget -- is deliberately excluded: bench/latency-n.mjs
# measures it at 751 ms p90 against our 350 ms. They afford it because their
# search is Rust/WASM; ours is JavaScript. That gap is a runtime difference,
# not a tuning secret, and no rate is worth doubling the lag.
#
#   phase 1  01:00-04:15  12 configs, 1000 games, seed 1
#   phase 2  04:15-09:40  top 2 + shipping control, FRESH seeds 2-4, 2000 games
#
# Sizing comes from last night's MEASURED throughput, not an estimate: with 9
# shards contending, a game costs ~5.5 s at N=96 and ~9 s at N=160. Last night
# phase 1 was sized on a single-process probe (~2 s/game) and only 9 of 21
# configs finished. Phase 1 here is ~1450 shard-minutes over 9 shards ~= 2.7 h.
#
# Every phase has a HARD deadline checked inside overnight.mjs's game loop, so
# an overrun truncates a config instead of eating the next phase.

set -u
cd "$(dirname "$0")/../.." || exit 1
BENCH=okey/bench
TAG=afford
SHARDS=9   # 12 cores, 3 left so the machine stays usable

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$BENCH/$TAG-driver.log"; }

# Deadlines are built from TODAY's date at run time, so a phase that starts
# after midnight compares against this morning's clock, never yesterday's
# (which would already be past and would stop every config instantly).
DAY=$(date +%Y-%m-%d)

run_phase() {
  local phase="$1" games="$2" deadline="$3" seed="$4" grid="$5"
  log "phase $phase: $games games/config, seed $seed, deadline $deadline"
  rm -f "$BENCH/$TAG-phase${phase}-shard"*.done
  for ((i = 0; i < SHARDS; i++)); do
    node "$BENCH/overnight.mjs" --shard "$i" --of "$SHARDS" --phase "$phase" \
      --tag "$TAG" --grid "$grid" --games "$games" --seed "$seed" \
      --deadline "$deadline" \
      >> "$BENCH/$TAG-phase${phase}.log" 2>&1 &
  done
  wait
  log "phase $phase done: $(wc -l < "$BENCH/$TAG-phase${phase}-results.jsonl" 2>/dev/null || echo 0) results"
}

log "=== okey affordable-config campaign starting ==="

# Task Scheduler does not hand a task the same PATH an interactive shell has.
# Fail loudly rather than leaving 9 hours of "command not found" in a log
# nobody reads until morning.
if ! command -v node >/dev/null 2>&1; then
  log "FATAL: node not on PATH under Task Scheduler — campaign aborted, nothing measured"
  exit 1
fi
log "node $(node --version), $SHARDS shards"

rm -f "$BENCH/$TAG-phase"*-results.jsonl "$BENCH/$TAG-final.jsonl"

# Step 0: latency on an IDLE machine, before the shards start competing for
# cores. Every latency number taken during the day is contaminated — a
# measurement at 19:00 with browsers open read 86% CPU and produced a p90 worse
# than the run before an optimisation that was provably faster in isolation.
# 01:00 with nothing else running is the only honest reading we get.
log "step 0: latency baseline on an idle machine"
node "$BENCH/latency-n.mjs" 14 2>&1 | tee -a "$BENCH/$TAG-latency.log" | tee -a "$BENCH/$TAG-driver.log"

run_phase 1 1000 "${DAY}T04:15" 1 affordable
node "$BENCH/tune-select.mjs" --tag "$TAG" --from 1 --to 2 --top 2 2>&1 | tee -a "$BENCH/$TAG-driver.log"

# Fresh seeds: the survivors plus the shipping control, re-measured on three
# shuffle sequences the tuning never saw. Phase 1 ranks on seed 1 alone, and a
# seed-1 winner has now failed this check twice in this project — last night's
# goldMin=0.20 "winner" lost gold significantly once it got here.
if [ ! -f "$BENCH/$TAG-phase2-configs.json" ]; then
  log "FATAL: phase 1 produced no ranked configs — nothing to confirm"
  exit 1
fi
for seed in 2 3 4; do
  cp "$BENCH/$TAG-phase2-configs.json" "$BENCH/$TAG-s$seed-phase2-configs.json"
done
log "phase 2: fresh seeds 2-4, 2000 games/config"
for seed in 2 3 4; do
  for shard in 0 1 2; do
    node "$BENCH/overnight.mjs" --shard "$shard" --of 3 --phase 2 \
      --tag "$TAG-s$seed" --games 2000 --seed "$seed" \
      --deadline "${DAY}T09:40" \
      >> "$BENCH/$TAG-phase2.log" 2>&1 &
  done
done
wait

log "=== campaign finished ==="
cat "$BENCH/$TAG-s"*"-phase2-results.jsonl" > "$BENCH/$TAG-final.jsonl" 2>/dev/null
log "final pooled results: $(wc -l < "$BENCH/$TAG-final.jsonl" 2>/dev/null || echo 0) rows in $TAG-final.jsonl"

# Release gate. Everything that must be green before publishing, run on an
# otherwise idle machine at the end of the campaign so the morning decision is
# "which config", never "is the build sound".
#
# smoke-outlook is EXCLUDED on purpose: it seeds from Math.random, so its
# false-call count differs between two runs of identical code and it cannot
# pass or fail anything. outlook-diff (seeded, position-by-position) is the
# check that actually answers that question, and it lives in the equivalence
# suite below.
log "=== release gate ==="
GATE_FAIL=0
for t in scorehand-equiv smoke-uifixes smoke-endgame smoke-policy smoke-outlook-partial; do
  if node "$BENCH/$t.mjs" >> "$BENCH/$TAG-gate.log" 2>&1; then
    log "  PASS $t"
  else
    log "  FAIL $t   <-- DO NOT PUBLISH until this is understood"
    GATE_FAIL=1
  fi
done

# Play must be byte-identical to the pre-optimisation baseline: the speed work
# and the zero-score fix are both meant to change timing and dead-position
# behaviour only. 293.5 / 4.8% gold / 46.2% silver on 2000 games at seed 1.
BASE=$(node "$BENCH/benchmark.mjs" 2000 --seed=1 2>/dev/null | grep "^v2 (default)")
log "  baseline row: $BASE"
case "$BASE" in
  *"293.5"*"4.8%"*"46.2%"*) log "  PASS v2 baseline unchanged" ;;
  *) log "  FAIL v2 baseline MOVED — the optimisations changed play"; GATE_FAIL=1 ;;
esac

if [ "$GATE_FAIL" -eq 0 ]; then
  log "=== release gate GREEN — safe to publish once a config is chosen ==="
else
  log "=== release gate RED — do not publish ==="
fi
