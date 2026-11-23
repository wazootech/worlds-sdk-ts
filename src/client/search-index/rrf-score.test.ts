import { expect, test } from "bun:test";
import {
  DEFAULT_RRF_K,
  normalizeRrfScore,
  type SearchScoreType,
} from "./rrf-score.ts";

test("RRF.normalizeRrfScore - rank 0 maps to exactly 1.0 (default k)", () => {
  expect(normalizeRrfScore(0)).toStrictEqual(1.0);
});

test("RRF.normalizeRrfScore - rank 0 maps to exactly 1.0 (custom k)", () => {
  expect(normalizeRrfScore(0, 1)).toStrictEqual(1.0);
  expect(normalizeRrfScore(0, 10_000)).toStrictEqual(1.0);
});

test("RRF.normalizeRrfScore - is strictly decreasing in rank", () => {
  // Sample a wide range of ranks and assert each successive score is lower.
  const ranks = [0, 1, 2, 5, 10, 25, 59, 60, 61, 100, 1_000, 10_000];
  for (let i = 1; i < ranks.length; i++) {
    const previous = normalizeRrfScore(ranks[i - 1]);
    const current = normalizeRrfScore(ranks[i]);
    expect(current < previous).toStrictEqual(true);
  }
});

test("RRF.normalizeRrfScore - stays in (0, 1] for all finite ranks", () => {
  for (const rank of [0, 1, 60, 1_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    const score = normalizeRrfScore(rank);
    expect(score > 0 && score <= 1).toStrictEqual(true);
  }
});

test("RRF.normalizeRrfScore - k edge cases", () => {
  // k = 1: rank 1 → 1 / (1 + 1) = 0.5
  expect(normalizeRrfScore(1, 1)).toStrictEqual(0.5);
  // k = 60: rank 60 → 60 / (60 + 60) = 0.5
  expect(normalizeRrfScore(60)).toStrictEqual(0.5);
  expect(normalizeRrfScore(60, 60)).toStrictEqual(0.5);
  // Larger k flattens the curve: same rank scores higher with larger k.
  const rank = 60;
  expect(normalizeRrfScore(rank, 120) > normalizeRrfScore(rank, 60)).toStrictEqual(true);
});

test("RRF.normalizeRrfScore - asymptotic behavior approaches 0 but never reaches it", () => {
  const score = normalizeRrfScore(Number.MAX_SAFE_INTEGER);
  expect(score > 0).toStrictEqual(true);
  // 60 / (60 + 2^53) ≈ 6.7e-15 — assert it degrades orders of magnitude below
  // the rank-1 score (60/61 ≈ 0.984) without ever reaching exactly 0.
  expect(score < 1e-12).toStrictEqual(true);
  expect(score === 0).toStrictEqual(false);
});

test("RRF.normalizeRrfScore - rejects invalid ranks", () => {
  expect(() => normalizeRrfScore(-1)).toThrow(RangeError);
  expect(() => normalizeRrfScore(Number.NaN)).toThrow(RangeError);
  expect(() => normalizeRrfScore(Number.POSITIVE_INFINITY)).toThrow(RangeError);
});

test("RRF.normalizeRrfScore - rejects invalid k", () => {
  expect(() => normalizeRrfScore(0, 0)).toThrow(RangeError);
  expect(() => normalizeRrfScore(0, -60)).toThrow(RangeError);
  expect(() => normalizeRrfScore(0, Number.NaN)).toThrow(RangeError);
});

test("RRF.DEFAULT_RRF_K - is the documented k = 60 constant", () => {
  expect(DEFAULT_RRF_K).toStrictEqual(60);
});

test("RRF.SearchScoreType - enumerates the contract score families", () => {
  const scoreTypes: Array<SearchScoreType> = ["rrf", "cosine", "unranked"];
  expect(scoreTypes.length).toStrictEqual(3);
  expect(scoreTypes.includes("rrf")).toStrictEqual(true);
  expect(scoreTypes.includes("cosine")).toStrictEqual(true);
  expect(scoreTypes.includes("unranked")).toStrictEqual(true);
});
