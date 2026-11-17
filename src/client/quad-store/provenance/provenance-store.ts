/**
 * ProvenanceRecordType discriminates write provenance from removal tombstones.
 */
export type ProvenanceRecordType = "write" | "remove";

/**
 * ImportProvenance is the application-supplied provenance metadata carried on
 * an ImportRequest; it stamps every quad that import writes.
 */
export interface ImportProvenance {
  /** writer optionally names the agent or process that performed the write. */
  writer?: string;

  /** source optionally names the feed, tool, or origin the data came from. */
  source?: string;
}

/**
 * ProvenanceRecord is a sidecar provenance entry keyed by a quad's
 * content-addressed ID (see hashQuad). Records are optional per quad: a
 * missing record means the quad was written before provenance recording
 * existed, and provenance queries must return the quad without metadata
 * rather than fail. No synthetic backfill timestamps are ever generated.
 */
export interface ProvenanceRecord {
  /** quadId is the content-addressed ID of the quad this record describes. */
  quadId: string;

  /** recordedAt is the ISO 8601 timestamp of the write or removal event. */
  recordedAt: string;

  /** type distinguishes a write record from a removal tombstone (default "write"). */
  type?: ProvenanceRecordType;

  /** writer optionally names the agent or process that performed the write. */
  writer?: string;

  /** source optionally names the feed, tool, or origin the data came from. */
  source?: string;

  /**
   * supersedesQuadId optionally links this record to the quad ID it replaces,
   * forming the correction chain that history walks in both directions.
   */
  supersedesQuadId?: string;
}

/**
 * ProvenanceRecordInput is the write shape for ProvenanceStore.record;
 * recordedAt defaults to the write time inside the store.
 */
export interface ProvenanceRecordInput {
  quadId: string;
  recordedAt?: string;
  type?: ProvenanceRecordType;
  writer?: string;
  source?: string;
  supersedesQuadId?: string;
}

/**
 * ProvenanceHistory is the supersedesQuadId chain around one quad, walked in
 * both directions.
 */
export interface ProvenanceHistory {
  /** quadId is the quad the chain was walked from. */
  quadId: string;

  /** supersedes lists ancestor records: quads this quad replaced, transitively. */
  supersedes: ProvenanceRecord[];

  /** supersededBy lists descendant records: quads that replaced this quad, transitively. */
  supersededBy: ProvenanceRecord[];
}

/**
 * ProvenanceListQuery narrows list to one quad or one record type.
 */
export interface ProvenanceListQuery {
  quadId?: string;
  type?: ProvenanceRecordType;
}

/**
 * ProvenanceStore is the append-only persistence contract for provenance
 * records. Durable backends implement this over their own storage (SQL
 * tables, KV buckets); the in-memory implementation backs RdfjsQuadStore.
 */
export interface ProvenanceStore {
  /**
   * record appends one provenance record. recordedAt defaults to the write
   * time. Appending is idempotent-friendly but never rewrites history.
   */
  record(input: ProvenanceRecordInput): Promise<ProvenanceRecord>;

  /** list returns records matching the query, oldest first. */
  list(query?: ProvenanceListQuery): Promise<ProvenanceRecord[]>;

  /**
   * history walks the supersedesQuadId chain for a quad in both directions:
   * what it replaced and what replaced it. Unknown quad IDs return an empty
   * chain, not an error.
   */
  history(quadId: string): Promise<ProvenanceHistory>;
}

/**
 * ProvenanceQueryRequest selects quads by RDF pattern; omitted or null
 * positions match anything, mirroring rdfjs Store.match.
 */
export interface ProvenanceQueryRequest {
  subject?: import("@rdfjs/types").Term | null;
  predicate?: import("@rdfjs/types").Term | null;
  object?: import("@rdfjs/types").Term | null;
}

/**
 * ProvenanceQueryResult pairs one matching quad with its sidecar records and
 * supersedes chain. A quad with no records still appears, with empty arrays.
 */
export interface ProvenanceQueryResult {
  quadId: string;
  quad: import("@rdfjs/types").Quad;
  records: ProvenanceRecord[];
  history: ProvenanceHistory;
}

/**
 * ProvenanceQueryResponse is the provenance query surface response.
 */
export interface ProvenanceQueryResponse {
  results: ProvenanceQueryResult[];
}

/**
 * ProvenanceQueryHandler is the capability any quad store or facade can offer
 * so WorldsSdk.provenance can delegate to it.
 */
export interface ProvenanceQueryHandler {
  provenanceQuery(
    request: ProvenanceQueryRequest,
  ): Promise<ProvenanceQueryResponse>;
}
