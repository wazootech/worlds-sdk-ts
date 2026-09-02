import type { QuadFilter } from "@/client/quad-store/mod.ts";

/**
 * SearchRequest defines the parameters for executing a keyword search, extending central QuadFilter rules.
 */
export interface SearchRequest extends QuadFilter {
  /** The fuzzy text query evaluated against the graph's Literal objects. */
  query: string;

  /** topK overrides the default search result limit at the SQL level (number of candidates returned before post-filtering). */
  topK?: number;

  /** minScore filters out results with a combined rank below this threshold (0.0 to 1.0). */
  minScore?: number;
}

/**
 * SearchResponse packages the set of discovered triple hits.
 */
export interface SearchResponse {
  /** Total collected hits matching criteria. */
  results?: Array<SearchResult>;
}

/**
 * ReindexRequest scopes search-index repair to quads matching QuadFilter boundaries.
 */
export interface ReindexRequest extends QuadFilter {
  /** readPageSize limits quads per SQL page during scan (default 1000). */
  readPageSize?: number;
}

/**
 * ReindexResponse reports repair counts (idempotent rerun safe).
 */
export interface ReindexResponse {
  /** processedQuadCount is the number of durable quads scanned during repair. */
  processedQuadCount: number;
  /** chunkRowCount is the number of chunk rows written to FTS/vector tables. */
  chunkRowCount: number;
}

/**
 * SearchResult is a hybrid keyword/vector hit against an RDF literal.
 */
export interface SearchResult {
  /** id is the stable deterministic identifier for ranking and evaluation. */
  id: string;

  /** subject is the subject resource of the hit */
  subject: string;

  /** predicate is the predicate resource of the hit */
  predicate: string;

  /** graph is the specific graph context that housed this statement */
  graph: string;

  /** text is the literal object of the hit */
  text: string;

  /**
   * score is the relevance score of the hit on the hosted search contract
   * scale (worlds-api#30 D7): a number in [0, 1] where 1.0 = best.
   *
   * - `rrf` scores are reciprocal rank fusion normalized via the
   *   `normalizeRrfScore` mapper (score = `k / (k + rank)`, k = 60, exported
   *   from this module's sibling `rrf-score.ts`), so rank 0 maps to exactly
   *   1.0 — raw `1/(k+rank)` values are NOT the contract scale and must be
   *   normalized before comparison against `minScore`.
   * - `cosine` scores are vector cosine similarity, already in [0, 1].
   * - `unranked` scores carry no ordering meaning (e.g. fallback search) and
   *   should be treated as null-equivalent by consumers.
   *
   * The `SearchScoreType` union (`"rrf" | "cosine" | "unranked"`) in
   * `rrf-score.ts` enumerates these families; backends opt in to emitting it
   * as part of the hosted search contract rollout (worlds-cloudflare#30).
   */
  score: number;
}

/**
 * SearchIndexInterface provides capability to query the system's search indices.
 */
export interface SearchIndexInterface {
  /**
   * search executes a keyword query against the indexed graph data.
   *
   * @param request contains the raw query string and optional include/exclude boundary filters.
   * @returns promise resolving to a set of relevancy-ranked triple matches.
   */
  search(request: SearchRequest): Promise<SearchResponse>;

  /**
   * reindex rebuilds derived search chunks from durable quads where a materialized index exists.
   *
   * @param request optional include/exclude scope and read page size.
   * @returns promise resolving to processed quad and chunk row counts.
   */
  reindex(request?: ReindexRequest): Promise<ReindexResponse>;
}

/**
 * SearchIndexOnImport controls when search chunk projection runs during bulk import.
 */
export type SearchIndexOnImport = "incremental" | "deferred" | "disabled";
