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
   * embeddingFailure is "throws" when an embedding error rejects the commit
   * before anything is written, or "degrades" when the commit succeeds and the
   * chunks are stored without vectors (repaired by a reindex).
   */
  embeddingFailure: "throws" | "degrades";

  /**
   * replaceImportFailure is what a replace-mode import that fails during its
   * write leaves behind: the old graph untouched, or an empty graph (the wipe
   * ran, the new data did not land). Neither may leave orphan chunk rows.
   */
  replaceImportFailure: "keeps-old-graph" | "empties-graph";

  /** defaultSearchIndexOnImport is the mode used when `searchIndexOnImport` is unset. */
  defaultSearchIndexOnImport: SearchIndexOnImport;
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
