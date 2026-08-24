#!/usr/bin/env bash
# Fresh-seed verification of the new defaults against the previous ones.
#
# Every ranking so far was computed on seed 1, so the winner could simply suit
# that one shuffle sequence. This re-measures both configurations on four seeds
# that were never used for ranking. 8 processes (2 configs x 4 seeds), each with
# a hard deadline that also interrupts a run in progress.
set -u
cd "$(dirname "$0")/../.." || exit 1
BENCH=okey/bench
DEADLINE="2026-08-24T14:30"
GAMES=3000

echo "[$(date +%H:%M:%S)] verification starting: $GAMES games x 2 configs x 4 seeds, deadline $DEADLINE" | tee -a "$BENCH/verify.log"
: > "$BENCH/overnight-phase5-results.jsonl"
for seed in 2 3 4 5; do
  for shard in 0 1; do
    node "$BENCH/overnight.mjs" --shard "$shard" --of 2 --phase 5 \
      --games "$GAMES" --seed "$seed" --deadline "$DEADLINE" \
      >> "$BENCH/verify.log" 2>&1 &
  done
done
wait
echo "[$(date +%H:%M:%S)] verification done" | tee -a "$BENCH/verify.log"
node "$BENCH/verify-report.mjs" | tee -a "$BENCH/verify.log"
