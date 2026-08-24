#!/usr/bin/env bash
# Overnight parameter search. Four phases, each hard-stopped well before 10:00.
#
#   phase 1  80 configs,  1000 games  -> which regions of the space are good
#   phase 2  top 10 + ship, 5000      -> which of those survives a real sample
#   phase 3  top 3 + ship, 20000      -> a number tight enough to publish
#   phase 4  winner + ship, 20000     -> on FRESH SEEDS. Phases 1-3 all rank on
#                                        seed 1, so the winner could simply fit
#                                        that one shuffle sequence. This is the
#                                        check that it is a real improvement.
#
# 9 shards in parallel (12 cores, 3 left for the machine's own work). Results
# are appended per finished config, so an interrupted phase still leaves
# everything measured so far.

set -u
cd "$(dirname "$0")/../.." || exit 1
BENCH=okey/bench
SHARDS=9

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$BENCH/overnight.log"; }

run_phase() {
  local phase="$1" games="$2" deadline="$3" seed="${4:-1}" shards="${5:-$SHARDS}"
  log "phase $phase starting: $games games/config, seed $seed, deadline $deadline"
  rm -f "$BENCH/overnight-phase${phase}-shard"*.done
  for ((i = 0; i < shards; i++)); do
    node "$BENCH/overnight.mjs" --shard "$i" --of "$shards" --phase "$phase" \
      --games "$games" --seed "$seed" --deadline "$deadline" \
      >> "$BENCH/overnight-phase${phase}.log" 2>&1 &
  done
  wait
  local n
  n=$(wc -l < "$BENCH/overnight-phase${phase}-results.jsonl" 2>/dev/null || echo 0)
  log "phase $phase done: $n configs measured"
}

log "=== overnight search starting ==="

: > "$BENCH/overnight-phase1-results.jsonl"
run_phase 1 1000 "2026-08-24T03:15"
node "$BENCH/pick-top.mjs" --phase 1 --take 10 --next 2 | tee -a "$BENCH/overnight.log"

: > "$BENCH/overnight-phase2-results.jsonl"
run_phase 2 5000 "2026-08-24T05:45"
node "$BENCH/pick-top.mjs" --phase 2 --take 3 --next 3 | tee -a "$BENCH/overnight.log"

: > "$BENCH/overnight-phase3-results.jsonl"
run_phase 3 20000 "2026-08-24T08:15"
node "$BENCH/pick-top.mjs" --phase 3 --take 1 --next 4 | tee -a "$BENCH/overnight.log"

# Phase 4 runs the same two configs on two seeds that were never used for
# ranking. Four processes, one per (config, seed) pair, so it stays fast.
: > "$BENCH/overnight-phase4-results.jsonl"
run_phase 4 20000 "2026-08-24T09:30" 2 2
run_phase 4 20000 "2026-08-24T09:40" 3 2

log "=== ALL PHASES COMPLETE ==="
node "$BENCH/pick-top.mjs" --phase 4 --take 2 --next 9 | tee -a "$BENCH/overnight.log"
