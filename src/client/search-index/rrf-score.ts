/**
 * DEFAULT_RRF_K is the reciprocal rank fusion constant used by all search
 * backends (RRF, $k = 60$). See the hosted search contract (worlds-api#30)
 * decision D7 for the score-scale requirements this module implements.
 */
export const DEFAULT_RRF_K = 60;

/**
 * SearchScoreType enumerates the scoring family a SearchResult.score expresses.
 *
 * - `"rrf"`: reciprocal rank fusion, normalized to the contract [0, 1] scale
 *   via {@link normalizeRrfScore} (rank 0 → 1.0).
 * - `"cosine"`: vector cosine similarity, already in [0, 1].
 * - `"unranked"`: no relevance ranking was produced (e.g. fallback search);
 *   score carries no ordering meaning.
 */
export type SearchScoreType = "rrf" | "cosine" | "unranked";

/**
 * normalizeRrfScore normalizes a raw reciprocal rank to the hosted search
 * contract scale (worlds-api#30 D7): `score = k / (k + rank)`.
 *
 * The raw RRF formula `1 / (k + rank)` tops out near 0.017 for realistic
 * result pools (k = 60, rank 0), which makes any caller-side `minScore` floor
 * meaningless. This mapper is the single normalization point for all backends
 * (sqlite, libsql, indexeddb, cloudflare) so that:
 *
 * - rank 0 → 1.0 (best possible score)
 * - scores are strictly decreasing in rank
 * - scores are always > 0 for any finite rank, approaching 0 asymptotically
 * - the transform is rank-monotone: result ordering is unchanged
 *
 * The hybrid fused-list factor for multi-list RRF is deliberately deferred
 * (Phase C, worlds-cloudflare#30) — no hybrid backend exists on the hosted
 * path yet, so single-list normalization is all the contract needs today.
 *
 * @param rank zero-based result rank (0 = best hit).
 * @param k reciprocal rank fusion constant; must be a finite number > 0.
 *   Defaults to {@link DEFAULT_RRF_K} (60).
 * @returns the normalized score in (0, 1], with 1.0 at rank 0.
 * @throws RangeError when rank is negative or non-finite, or k is not a
 *   finite number > 0.
 */
export function normalizeRrfScore(
  rank: number,
  k: number = DEFAULT_RRF_K,
): number {
  if (!Number.isFinite(rank) || rank < 0) {
    throw new RangeError(
      `normalizeRrfScore: rank must be a finite number >= 0, got ${rank}`,
    );
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError(
      `normalizeRrfScore: k must be a finite number > 0, got ${k}`,
    );
  }
  return k / (k + rank);
}
