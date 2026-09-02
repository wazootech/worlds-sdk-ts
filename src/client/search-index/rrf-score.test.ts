import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_RRF_K,
  normalizeRrfScore,
  type SearchScoreType,
} from "./rrf-score.ts";

Deno.test("RRF.normalizeRrfScore - rank 0 maps to exactly 1.0 (default k)", () => {
  assertEquals(normalizeRrfScore(0), 1.0);
});

Deno.test("RRF.normalizeRrfScore - rank 0 maps to exactly 1.0 (custom k)", () => {
  assertEquals(normalizeRrfScore(0, 1), 1.0);
  assertEquals(normalizeRrfScore(0, 10_000), 1.0);
});

Deno.test("RRF.normalizeRrfScore - is strictly decreasing in rank", () => {
  // Sample a wide range of ranks and assert each successive score is lower.
  const ranks = [0, 1, 2, 5, 10, 25, 59, 60, 61, 100, 1_000, 10_000];
  for (let i = 1; i < ranks.length; i++) {
    const previous = normalizeRrfScore(ranks[i - 1]);
    const current = normalizeRrfScore(ranks[i]);
    assertEquals(
      current < previous,
      true,
      `score at rank ${ranks[i]} (${current}) must be < score at rank ${
        ranks[i - 1]
      } (${previous})`,
    );
  }
});

Deno.test("RRF.normalizeRrfScore - stays in (0, 1] for all finite ranks", () => {
  for (const rank of [0, 1, 60, 1_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    const score = normalizeRrfScore(rank);
    assertEquals(
      score > 0 && score <= 1,
      true,
      `score ${score} at rank ${rank}`,
    );
  }
});

Deno.test("RRF.normalizeRrfScore - k edge cases", () => {
  // k = 1: rank 1 → 1 / (1 + 1) = 0.5
  assertEquals(normalizeRrfScore(1, 1), 0.5);
  // k = 60: rank 60 → 60 / (60 + 60) = 0.5
  assertEquals(normalizeRrfScore(60), 0.5);
  assertEquals(normalizeRrfScore(60, 60), 0.5);
  // Larger k flattens the curve: same rank scores higher with larger k.
  const rank = 60;
  assertEquals(
    normalizeRrfScore(rank, 120) > normalizeRrfScore(rank, 60),
    true,
    "larger k should yield a higher normalized score at the same rank",
  );
});

Deno.test("RRF.normalizeRrfScore - asymptotic behavior approaches 0 but never reaches it", () => {
  const score = normalizeRrfScore(Number.MAX_SAFE_INTEGER);
  assertEquals(score > 0, true);
  // 60 / (60 + 2^53) ≈ 6.7e-15 — assert it degrades orders of magnitude below
  // the rank-1 score (60/61 ≈ 0.984) without ever reaching exactly 0.
  assertEquals(score < 1e-12, true, "far ranks should be near-zero");
  assertEquals(score === 0, false, "score must remain strictly positive");
});

Deno.test("RRF.normalizeRrfScore - rejects invalid ranks", () => {
  assertThrows(() => normalizeRrfScore(-1), RangeError);
  assertThrows(() => normalizeRrfScore(Number.NaN), RangeError);
  assertThrows(() => normalizeRrfScore(Number.POSITIVE_INFINITY), RangeError);
});

Deno.test("RRF.normalizeRrfScore - rejects invalid k", () => {
  assertThrows(() => normalizeRrfScore(0, 0), RangeError);
  assertThrows(() => normalizeRrfScore(0, -60), RangeError);
  assertThrows(() => normalizeRrfScore(0, Number.NaN), RangeError);
});

Deno.test("RRF.DEFAULT_RRF_K - is the documented k = 60 constant", () => {
  assertEquals(DEFAULT_RRF_K, 60);
});

Deno.test("RRF.SearchScoreType - enumerates the contract score families", () => {
  const scoreTypes: Array<SearchScoreType> = ["rrf", "cosine", "unranked"];
  assertEquals(scoreTypes.length, 3);
  assertEquals(scoreTypes.includes("rrf"), true);
  assertEquals(scoreTypes.includes("cosine"), true);
  assertEquals(scoreTypes.includes("unranked"), true);
});
