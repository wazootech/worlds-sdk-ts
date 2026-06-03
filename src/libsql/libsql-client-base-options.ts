import type { Client as LibsqlClient } from "@libsql/client";
import type { QuadFilter } from "@/client/quad-store/mod.ts";
import type { SearchIndexOnImport } from "@/client/search-index/mod.ts";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import type { TextSplitterInterface } from "@/client/search-index/quad-chunker/mod.ts";

/**
 * LibsqlClientBaseOptions lists configuration shared by quad index LibSQL client factories.
 */
export interface LibsqlClientBaseOptions extends QuadFilter {
  /** client is the underlying LibSQL client pointing to the database. */
  client: LibsqlClient;

  /** embeddingService is an optional service projected for transforming text literals into comparison vectors. */
  embeddingService?: EmbeddingService;

  /** textSplitter is an optional custom text splitting facility, defaults to sensible character-based splitting. */
  textSplitter?: TextSplitterInterface;

  /** maxLookupChunkSize specifies the maximum number of host parameters allowed in cache query IN clauses before split-chunking. Defaults to a conservative 800 (safely below historical SQLite 999 SQLITE_MAX_VARIABLE_NUMBER variable caps with generous headroom). */
  maxLookupChunkSize?: number;

  /**
   * vectorDimensions pins F32_BLOB width for chunk vectors and must match every embedding produced when embeddingService is set (default 32).
   */
  vectorDimensions?: number;

  /**
   * matchPageSize limits rows per LibsqlRdfjsStore.match SQL round-trip on reads (default 1000).
   */
  matchPageSize?: number;

  /**
   * labelPredicates extends built-in label IRIs used for subject alias discovery (union, deduped).
   */
  labelPredicates?: string[];

  /**
   * searchIndexOnImport controls when FTS/vector chunk projection runs during import.
   *
   * - `"incremental"` (default when omitted): chunks each quad on commit.
   * - `"deferred"`: persists quads on each import, rebuilds FTS/vector chunks in one pass afterward.
   * - `"disabled"`: skips chunking entirely; caller calls `client.reindex()` before searching.
   */
  searchIndexOnImport?: SearchIndexOnImport;
}
