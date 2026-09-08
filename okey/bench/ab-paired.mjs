// Paired comparison of two --dump runs of ab-tiebreak.mjs.
//
// Why this exists: the +-x% printed next to each config is the interval of that
// config's own rate, and it is dominated by the decks, not by the policy. Both
// configs played the SAME decks, so almost all of that spread cancels — judging
// a change by whether the two intervals overlap throws the pairing away and
// calls real improvements inconclusive.
//
// Two tests, because the two questions are different:
//
//   chest rate  — McNemar on the games where exactly one config reached silver.
//                 Games both won or both lost carry no information about which
//                 config is better and are excluded by construction.
//   score       — paired bootstrap on the per-game difference. No normality
//                 assumption, which matters here: the score distribution is
//                 lumpy (multiples of 10, a hard floor at 0) and bimodal around
//                 the silver threshold.
//
// Usage: node bench/ab-paired.mjs bench/paired-before.jsonl bench/paired-after.jsonl

import fs from "node:fs";

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error("usage: node bench/ab-paired.mjs <a.jsonl> <b.jsonl>");
  process.exit(2);
}

const read = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const A = read(fileA);
const B = read(fileB);
if (A.length !== B.length) {
  console.error(`different game counts: ${A.length} vs ${B.length} — not paired`);
  process.exit(2);
}

const nameA = A[0].config, nameB = B[0].config;
const isSilver = (r) => r.chest === "silver" || r.chest === "gold";
const isGold = (r) => r.chest === "gold";

function mcnemar(label, hit) {
  // b = A won it and B did not, c = the other way round.
  let b = 0, c = 0;
  for (let i = 0; i < A.length; i++) {
    const a = hit(A[i]), d = hit(B[i]);
    if (a && !d) b++;
    else if (!a && d) c++;
  }
  const n = b + c;
  if (n === 0) { console.log(`${label}: identical on every game`); return; }
  // Normal approximation to the exact binomial, with the continuity correction.
  const chi = (Math.abs(b - c) - 1) ** 2 / n;
  // Two-sided p from chi-square with 1 df = 2 * (1 - Phi(sqrt(chi))).
  const z = Math.sqrt(Math.max(0, chi));
  const p = 2 * (1 - normalCdf(z));
  const winner = c > b ? nameB : nameA;
  console.log(
    `${label}: ${nameA} only ${b} games, ${nameB} only ${c} games ` +
    `-> ${winner} ahead by ${Math.abs(c - b)} of ${A.length}, p = ${p < 0.0001 ? "<0.0001" : p.toFixed(4)}`,
  );
}

function normalCdf(x) {
  // Abramowitz & Stegun 26.2.17, plenty for a p-value we only read to 4 places.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function bootstrapMeanDiff(iters = 20000) {
  const d = A.map((a, i) => B[i].score - a.score);
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const draws = new Float64Array(iters);
  let seed = 12345;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let k = 0; k < iters; k++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[Math.floor(rand() * d.length)];
    draws[k] = s / d.length;
  }
  draws.sort();
  const lo = draws[Math.floor(iters * 0.025)];
  const hi = draws[Math.floor(iters * 0.975)];
  console.log(
    `avg score: ${nameB} - ${nameA} = ${mean >= 0 ? "+" : ""}${mean.toFixed(1)} points ` +
    `(95% ${lo >= 0 ? "+" : ""}${lo.toFixed(1)} .. ${hi >= 0 ? "+" : ""}${hi.toFixed(1)})`,
  );
}

const rate = (rows, hit) => (rows.filter(hit).length / rows.length * 100).toFixed(1) + "%";
console.log(`paired over ${A.length} identical decks: ${nameA} vs ${nameB}`);
console.log("");
console.log(`silver+   ${nameA} ${rate(A, isSilver)}   ${nameB} ${rate(B, isSilver)}`);
console.log(`gold      ${nameA} ${rate(A, isGold)}   ${nameB} ${rate(B, isGold)}`);
console.log("");
mcnemar("silver+  ", isSilver);
mcnemar("gold     ", isGold);
bootstrapMeanDiff();
