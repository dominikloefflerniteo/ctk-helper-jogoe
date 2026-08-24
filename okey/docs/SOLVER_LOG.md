# Okey solver log

Every entry is measured with `node bench/benchmark.mjs 5000` (5000 games,
seed 1, paired — all policies see the same deck orders). Chests: gold >= 400,
silver >= 300, bronze below.

Reference rows repeated in every run:

| policy | avg | gold | silver | bronze | picks | discards |
|---|---|---|---|---|---|---|
| greedy (never discard) | 147.7 | 0.1% | 2.6% | 97.3% | 8.00 | 0 |
| v1 OC=5 (state at "okey init") | 262.9 | 2.4% | 28.2% | 69.4% | 4.77 | 8.57 |

---

## Iteration 0 — baseline (commit `140db8d`)

**v1**: flat 5-point opportunity cost per discard, pick judged by its own score.
One-ply EV: for each single discard, expected best pick after one random draw.

| | avg | gold | silver | bronze |
|---|---|---|---|---|
| v1 OC=5 | 262.9 | 2.4% | 28.2% | 69.4% |

OC grid 0..12 (2000 games) reproduced the original tuning exactly: plateau at
4-7, best at 5. So the constant was not the problem — the policy shape was.

**Diagnosis.** The deck is perfect information (24 unique cards, consumed for
good), so the game is a *partition* problem: split 24 known cards into as few,
as valuable triples as possible. Best hand-built partition of a full deck is
~590 pts. v1 sees none of that — it cannot tell that spending R6/R7/B8 on a
60-point mixed run destroys a 100-point same-colour run plus two triples.

## Iteration 1 — potential-based costs (v2)

New `potential.js`: `potentialOf(card)` = best combo still ALIVE that the card
can join, computed from the exact remaining card set (triple needs all three
colours of a value; same-colour run needs both neighbours in that colour).

Replaces both v1 constants:

- discard cost = `lambda * potential(card) / 3` — a combo eats 3 cards, so one
  card is ~1/3 of the best combo it could still join. Dumping a dead 2 costs
  ~3; dumping the B7 between a live B6 and B8 costs ~33.
- pick damage = `lambda * max(0, avg(potential of the 3 cards) - score)` — a
  mixed 6-7-8 for 60 spends cards each worth ~90, so it is punished; a
  same-colour 6-7-8 for 100 spends them at full value, so it is free.

lambda grid (5000 games): 0.5 -> 277.4, 1 -> 283.9, 2 -> 288.7, 3 -> 290.5,
4 -> 292.5, **6 -> 293.2**, 8 -> 293.5, 12 -> 293.2, 20 -> 293.1. Monotone to
~6 then flat; default set to **6** (mid-plateau, not fragile).

| | avg | gold | silver | bronze | picks | discards |
|---|---|---|---|---|---|---|
| v1 OC=5 | 262.9 | 2.4% | 28.2% | 69.4% | 4.77 | 8.57 |
| **v2 L=6** | **293.2** | **5.2%** | **45.5%** | 49.3% | 4.00 | 10.91 |

**Delta: +30.3 avg (+11.5%), silver +17.3pp (28.2% -> 45.5%), gold 2.2x
(2.4% -> 5.2%).** Bronze drops below half for the first time.

Behaviour change: v2 plays one fewer round (4.00 vs 4.77 picks) but each pick
is worth ~73 instead of ~55 — it refuses to cash cheap mixed runs and spends
the saved rounds building same-colour runs.

## Iteration 2 — endgame scaling + final-round threshold play (NO GAIN)

Two changes, both defensible, neither measurable:

1. `scale = clamp((picksLeft - 1) / 2, 0, 1)` fades the potential costs out as
   rounds run out — protecting a card you can no longer spend is pointless.
2. On the last round, stop maximising points and maximise P(reach the next
   chest): exact one-draw probabilities, target = silver while below it, gold
   once silver is banked.

| | avg | gold | silver |
|---|---|---|---|
| v2 L=6, no endgame | 293.2 | 5.2% | 45.5% |
| v2 L=6 + endgame | 293.6 | 5.2% | 45.5% |

**Delta: +0.4 avg — noise.** Kept anyway: it costs nothing and the last-round
logic is simply correct (it is also what iteration 5 generalises). The lesson
is that by the time `picksLeft <= 1` the board is nearly forced, so there is
no decision left to improve.

## Iteration 3 — evaluate every pick, not just the highest (NO GAIN)

v2 only costed the top-scoring hand. If that hand looked bad it discarded,
never checking whether a *cheaper* hand (say the triple 3s instead of the
mixed 6-7-8) was the better spend. Now every C(5,3) hand is scored by net
value.

| | avg | gold | silver |
|---|---|---|---|
| before | 293.2 | 5.2% | 45.5% |
| after | 293.3 | 5.2% | 45.5% |

**Delta: +0.1 — noise.** Kept because it is strictly more correct, but in
practice when the top hand is a bad spend, so is every worse hand on the same
board, and the solver was already discarding in those spots.

## Iteration 4 — board-aware "synergy" potential (REJECTED)

Hypothesis: `potentialOf` judges a card in isolation, so a lone R6 and an R6
sitting beside an R7 read the same. Weighted each alive combo by how many of
its partners are already face-up (2 -> 1.0, 1 -> PARTNER, 0 -> LONE).

First attempt scored 272.6 — a 20-point regression. Cause found: the cards of
the hand being picked all sit on the board, so their combo gets weight 1.0 and
the pick damage collapses to ~0, making the solver pick constantly (5.2
picks/game instead of 4.0). Fixed by excluding the combo being taken from the
alternative-use calculation.

Still worse. lambda turned out to be irrelevant (6 -> 48 all within 2 pts), so
the weights themselves were swept:

| lone/partner | avg | gold | silver |
|---|---|---|---|
| 0.25 / 0.55 | 271.4 | 2.5% | 31.0% |
| 0.25 / 1.0 | 279.4 | 3.6% | 37.4% |
| 0.5 / 1.0 | 285.5 | 4.8% | 39.5% |
| 0.75 / 1.0 | 290.5 | 5.6% | 41.1% |
| 1.0 / 1.0 (= plain v2) | 293.1 | 5.2% | 45.2% |

**Monotone toward 1.0/1.0 — the idea is dead.** Reason, in hindsight: the
one-draw EV term already prices board synergy (a pair plus the right draw *is*
the combo it measures), so the potential term only needs to price the future,
and discounting it just made the solver impatient. `synergyPotential()` stays
in potential.js, off by default, so the experiment is not re-run blind.

## Iteration 4b — exact EV, 20x cheaper (no score change, unlocks search)

`expectedScoreAfterDiscard` re-ranked the whole board once per deck card. But
after a discard four cards stay, and a drawn card can only score by joining
two of them — so the best pick after the draw is
`max(best pick among the 4 kept, best combo the drawn card completes)`, and
the second term is a lookup table built from the C(4,2)=6 pairs.

`evAfterSingleDiscard()` returns bit-identical numbers (verified: 6000
comparisons, max |old - new| = 0) at roughly 1/20th the work. Nothing changes
in the ranking; it is what makes rollout search affordable.

## Iteration 5 — policy rollout with a chest objective (BIG GAIN)

The heuristic maximises expected points. Chests are thresholds, and no amount
of extra terms in a points-maximiser can express "we need 50 more, so take the
gamble". Rollout instead (rollout.js): apply each candidate move, let v2 play
the rest against a random deck order N times, rank by how often that ends in
silver/gold. All candidates see the SAME N deck orders (common random numbers),
so the comparison is paired and N can stay small.

400 games, seed 1:

| policy | avg | gold | silver | bronze |
|---|---|---|---|---|
| v2 L=6 | 291.7 | 5.0% | 45.8% | 49.3% |
| rollout, silver first | 302.4 | 4.0% | **62.0%** | 34.0% |
| rollout, balanced (silver + 2*gold) | 303.9 | **5.8%** | 61.5% | 32.8% |
| rollout, gold first | 297.4 | 6.3% | 53.3% | 40.5% |
| rollout, plain expected points | **312.3** | 6.3% | 55.8% | 38.0% |

**Delta over v2: +12 avg, silver +16pp.** Objective choice matters as much as
the search: chasing gold outright costs 8pp of silver to buy 0.5pp of gold —
a bad trade. "Balanced" takes almost the maximum of both, and is the default.

Cost: 24 rollouts x up to 8 candidates ~ 120 ms per suggestion (bench/latency.mjs).

## Iteration 6 — exact endgame solver (the ceiling-closer)

`endgame.js`. Once few cards remain the position is small enough to solve
outright: state = (cards still in play, the face-up cards), actions = pick 3 /
discard 1, chance = uniform draw. Consumed cards never matter again, so a
position with `a` cards has O(3^a) reachable states, not O(2^24).

Value of a state is not a number but a curve — P(at least 0 more points),
P(at least 10 more), ... — because every combo pays a multiple of 10. One pass
therefore answers silver AND gold AND "we are 40 short with two rounds left",
and the optimal action may legitimately differ per threshold. That is the
behaviour we want: the same board is "bank it" at 20 short and "gamble" at 90.

**Verified exact.** Predictions checked against actually playing the position
out 4000 times, on the uncertain thresholds only (0/1 predictions prove
nothing): predicted 0.538 / 0.319 / 0.233 vs measured 0.531 / 0.323 / 0.224 —
all inside Monte-Carlo noise.

**Cost by stage** (bench/endgame-timing.mjs), ~2.8x per extra card in play:

| cards left | states | time |
|---|---|---|
| 10 | 1,906 | 17 ms |
| 11 | 5,715 | 46 ms |
| 12 | 16,754 | 201 ms |
| 13 | 48,004 | 632 ms |
| 14 | 134,903 | 2.2 s |
| 16 | 1,003,481 | 22 s |
| 18 | >3,000,000 | aborted, 88 s |

Extrapolated to the opening position (24 cards): ~3.8 billion states, ~27
hours, >1 TB. Exact play from turn one is out by a wide margin — but the line
falls in a useful place.

**Shipped as policy.js**: exact at <= 12 cards in play, rollout above that,
cheap heuristic while the field is still being filled in. One table per game,
kept across turns (every later position is a sub-position of the first), so
the first exact turn costs ~200 ms and every later one is free. Measured on a
real game: 152/95/83/82/81/78/57/58 ms of rollout, then 204 ms once, then 0 ms
for the rest.

## Ceiling — how much is actually there

`bench/ceiling.mjs` computes, per game, the best score a player could have
made if they had known the draw order in advance (exact DP over the fixed
order). 200 games, seed 1:

| | avg | gold | silver | worst game |
|---|---|---|---|---|
| hindsight optimum | 377.2 | 31.5% | **100.0%** | 300 |
| v2 heuristic | 291.7 | 5.0% | 45.8% | — |

**Silver is reachable in every single deck** — the minimum over 200 games is
exactly 300. Silver is therefore a question of play, not of luck, and the 45%
the heuristic managed was leaving half of it on the table.

## Human baseline — "only chase the 6-7-8"

How the event is actually played today: click fast, keep only 6s, 7s and 8s,
take a same-colour 6-7-8 for 100 whenever it completes, stop the run when the
field is nothing but 6/7/8 and none of them can finish. `bench/human-baseline.mjs`,
20000 games:

| variant | avg | gold | silver | bronze |
|---|---|---|---|---|
| strict (stop when stuck) | 107.4 | 0.0% | 35.8% | 64.2% |
| trim (throw the deadest 6/7/8 instead of stopping) | 244.7 | 0.0% | 36.0% | 64.0% |
| cash (take the best hand instead of stopping) | 251.1 | 0.0% | 36.0% | 64.0% |

Two structural facts fall out:

**Runs completed per game: 0x in 64.2%, 3x in 35.8%, nothing in between.**
There are exactly 9 target cards. Complete one run and 6 remain, forming
exactly two colour sets; 5 of those 6 fit on the field, and any 5 of 6 must
contain at least one complete set — so the second and third runs are forced.
The whole strategy is decided by whether the first five 6/7/8s drawn happen to
contain one colour set. That is also why the stopping rule barely matters: all
three variants land on ~36% silver.

**Gold is impossible this way.** Three 100-point runs is 300 — exactly the
silver line and the hard ceiling of the strategy.

For comparison, the shipped policy reaches ~61% silver and ~6% gold.

## Iteration 7 — colour symmetry in the exact solver (REJECTED)

Red, blue and yellow are fully interchangeable, so folding the memo key onto a
canonical colouring should collapse up to 6 states into 1. Implemented and
A/B-checked (bench/symmetry-check.mjs):

| | states | time |
|---|---|---|
| without symmetry | 68,464 | 860 ms |
| with symmetry | 66,195 | 954 ms |

Results identical to the last digit — and **1.03x fewer states, 11% slower**.

Why it fails: from a real position the set of cards in play is FIXED.
Recolouring it yields a card set that never occurs anywhere in that search
tree, so nothing collapses; all that remains is the extra work of computing
the canonical key on every lookup. Symmetry would only pay for a fully
precomputed table over all positions, which is a different project. Kept in
the code, off by default, so it is not retried blind.

## Iteration 8 — rollouts that end in the exact solver (SHIPPED, hypothesis was wrong)

The playouts inside a rollout were finished by the v2 heuristic, which only
reaches ~46% silver on its own, so every estimate carried that weakness. New:
a playout stops once the position is small enough and the exact solver
evaluates it. That also cuts variance sharply — a leaf returns a probability
(0.62), not a coin flip (0 or 1).

I expected this to backfire. A weak head with a perfect tail rewards reaching
the tail, so burning cards on cheap hands should have started to look good —
and the first game I watched did exactly that. **The data says no** (120
games, seed 1, N=16):

| leaf cutoff | avg | gold | silver | bronze | latency |
|---|---|---|---|---|---|
| 0 (rollout to the end) | 306.1 | 5.8% | 60.0% | 34.2% | 105 ms |
| **8** | 308.8 | 5.0% | **62.5%** | 32.5% | **197 ms** |
| 10 | 310.7 | 4.2% | **66.7%** | 29.2% | 1240 ms |

At 120 games the error bar is +-4.4pp, so the ordering is suggestive rather
than proven, but the direction is consistently positive and the single bad
game was an anecdote. Recorded here as a hypothesis that did not survive
contact with a measurement.

Latency decides the cutoff, not quality: leaf=10 is the better player and is
unusable at 1.2 s. Shipping **N=16 with leaf=8 at 197 ms**, inside the 200 ms
budget (bench/latency.mjs has the full grid).

## Iteration 9 — overnight search over all knobs at once (SHIPPED)

Every knob so far was tuned alone with the others held fixed. `bench/overnight.mjs`
varies them together — N, exact-leaf cutoff, exact-solver cutoff, heuristic
lambda, objective — against the same deck orders.

The run overran its window badly (planned 1-3 min per config, actual up to 88
min at 9-way parallelism) and was stopped part-way: 34 of 80 configs at 1000
games, 5 of 11 at 5000. The deadline logic only guarded *starting* a config,
never interrupted one in progress; that is fixed now (checked inside the game
loop).

Partial as it was, it settled a real question — at 5000 games each:

| config | silver+ | gold | avg |
|---|---|---|---|
| N=24, leaf off, exact<=12 | 66.2% | 6.2% | 307.1 |
| N=24, leaf off, exact<=10 | 65.9% | 6.1% | 305.9 |
| N=16, leaf off, exact<=13 | 63.6% | 6.0% | 305.1 |
| N=16, leaf 8, exact<=12 (was shipping) | 63.1% | 5.8% | 304.4 |

**The exact-leaf evaluation from iteration 8 does not survive.** It looked good
at 120 games with N held at 16; measured together with N over 5000 games, the
leaf variants match leaf=0 exactly, and the time it costs buys more silver when
spent on rollouts. N and the leaf cutoff compete for one time budget — tuning
either alone cannot see that.

### Fresh-seed verification

Every ranking above is on seed 1, so the winner could merely suit that shuffle
sequence. Both configs re-measured on **seeds 2-5, 3000 games each (12000
pooled)**:

| config | silver+ | gold | avg |
|---|---|---|---|
| **N=24, leaf off (now shipping)** | **64.8% ±0.9** | 6.4% | 306.8 |
| N=16, leaf 8 (previous) | 62.9% ±0.9 | 6.3% | 304.5 |

**Confirmed, but smaller than claimed: +1.9pp, not +3.1pp.** The seed-1 ranking
was mildly overfitted to its own seed — which is exactly why this phase exists.
Gold is unchanged. Published figures now come from this run.

### Responsiveness

The search no longer runs on every click. A position is searched once and the
answer cached (selecting a card for your pick does not change the position, so
it costs nothing), and when the position does change the instant heuristic
answer renders first with the full search handed to a timeout. Per-click cost:
~180 ms -> 0.07 ms blocking; the strong answer replaces the provisional one a
moment later.
