import type * as rdfjs from "@rdfjs/types";
import type { Patch, TransactionContext } from "@/client/quad-store/mod.ts";
import type { SearchIndexOnImport } from "@/client/search-index/mod.ts";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";

/**
 * CommitConformanceContract is what a backend promises about failures and
 * defaults. The suite checks the promise, so a backend that cannot be atomic
 * (D1, Vectorize) declares that instead of failing the suite.
 */
export interface CommitConformanceContract {
  /**
   * atomic is true when a failed write leaves no new quads and no new chunk
   * rows. When false, the backend still promises no chunk row refers to a quad
   * that is not stored.
   */
  atomic: boolean;

  /**
   * embeddingFailure is "throws": an embedding error rejects the commit before
   * anything is written, on every backend. It is the only value; the field
   * stays so existing contracts compile.
   */
  embeddingFailure: "throws";

  /**
   * replaceImportFailure is what a replace-mode import that fails during its
   * write leaves behind: the old graph untouched, or an empty graph (the wipe
   * ran, the new data did not land). Neither may leave orphan chunk rows.
   */
  replaceImportFailure: "keeps-old-graph" | "empties-graph";

  /** defaultSearchIndexOnImport is the mode used when `searchIndexOnImport` is unset. */
  defaultSearchIndexOnImport: SearchIndexOnImport;

  /**
   * laterWriteFailure is what a commit leaves behind when a write that comes
   * after its quad writes fails (see `failLaterWrite`). Optional; the default is
   * "restores-prior-state". An atomic backend always restores the prior state, so
   * the field is ignored when `atomic` is true.
   *
   * - "restores-prior-state": the failed commit's quads and chunk rows are gone
   *   (rolled back, or removed by a cleanup).
   * - "keeps-written-quads": the quads already written stay stored. The backend
   *   still promises no chunk row refers to a quad that is not stored.
   */
  laterWriteFailure?: "restores-prior-state" | "keeps-written-quads";
}

/** CommitConformanceCreateOptions is what the suite configures on each fresh subject. */
export interface CommitConformanceCreateOptions {
  /** searchIndexOnImport is the mode under test; undefined must select the declared default. */
  searchIndexOnImport?: SearchIndexOnImport;

  /**
   * embeddingService is the service to wire. It returns 32-dimension vectors, or
   * rejects on purpose; the subject must wire it as given (vectorDimensions 32).
   */
  embeddingService: EmbeddingService;
}

/**
 * CommitConformanceSubject is a backend's commit path under test, wired with a
 * text splitter that keeps each literal as one chunk and with failure hooks.
 */
export interface CommitConformanceSubject {
  /** commit runs the backend's real commit path (the same one `Transaction.commit` reaches). */
  commit(patch: Patch, context?: TransactionContext): Promise<void>;

  /** storedQuads returns every quad the backend currently stores. */
  storedQuads(): Promise<rdfjs.Quad[]>;

  /** chunkedQuadIds returns the quad hash of every search chunk row, one entry per row. */
  chunkedQuadIds(): Promise<string[]>;

  /**
   * failNextWrite makes the next write to durable storage fail once, after any
   * embedding has finished. Earlier and later writes are unaffected.
   */
  failNextWrite(): void;

  /**
   * failLaterWrite is optional. It makes the next commit fail on a write that
   * comes after that commit's quad writes have been applied, once: a chunk-row
   * write inside the same transaction or batch, or a later batch of a chunked
   * commit. `failNextWrite` hits the first write, so it cannot tell an atomic
   * backend (which rolls the quad writes back) from a non-atomic one (which must
   * clean them up, or declare `laterWriteFailure: "keeps-written-quads"`).
   * Without this hook the suite skips the later-write case and says so in
   * `report.notes`. The commit that fails must insert at least two novel textual
   * quads under `searchIndexOnImport: "incremental"`, so a chunk write follows
   * the quad writes; a backend whose commit is chunked should size its batches
   * so the failing write is not the first batch.
   */
  failLaterWrite?(): void;

  /** fullRebuildCount returns how many full search-index rebuilds have run. */
  fullRebuildCount(): number;
}

/** CommitConformanceFactory creates a fresh, empty subject. */
export type CommitConformanceFactory = (
  options: CommitConformanceCreateOptions,
) => Promise<CommitConformanceSubject> | CommitConformanceSubject;

/** CommitConformanceSuiteOptions configures one run of the suite. */
export interface CommitConformanceSuiteOptions {
  /** create builds a fresh subject per case. */
  create: CommitConformanceFactory;

  /** contract declares the backend's failure and default behavior. */
  contract: CommitConformanceContract;
}
