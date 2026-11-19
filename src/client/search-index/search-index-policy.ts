import type { TransactionContext } from "@/client/quad-store/mod.ts";
import { isImportCommit } from "@/client/quad-store/mod.ts";
import type { SearchIndexOnImport } from "./search-index-interface.ts";

/**
 * DEFAULT_SEARCH_INDEX_ON_IMPORT is the mode a backend uses when the option is
 * unset: project chunks as quads are written. `@worlds/cloudflare` defaults to
 * "deferred" instead and passes that as `defaultMode` below.
 */
export const DEFAULT_SEARCH_INDEX_ON_IMPORT: SearchIndexOnImport =
  "incremental";

/** SearchIndexPlan says what search indexing a single commit owes. */
export interface SearchIndexPlan {
  /**
   * projectDuringCommit is true when the commit writes chunk rows (FTS and
   * vectors) for the quads it writes, in the same commit.
   */
  projectDuringCommit: boolean;

  /**
   * reindexAfterCommit is true when a full rebuild of the search index from
   * the stored quads must follow the commit (a deferred import).
   */
  reindexAfterCommit: boolean;
}

/** PlanSearchIndexingOptions adjusts the policy for a backend's own default. */
export interface PlanSearchIndexingOptions {
  /** defaultMode applies when `mode` is undefined. Defaults to DEFAULT_SEARCH_INDEX_ON_IMPORT. */
  defaultMode?: SearchIndexOnImport;
}

/**
 * planSearchIndexing decides, from the configured `searchIndexOnImport` and the
 * commit's context, whether to project during the commit and whether to
 * rebuild afterwards:
 *
 * - "disabled": never project, never rebuild.
 * - "incremental": project during every commit, never rebuild.
 * - "deferred": project during ordinary commits; an import (merge or replace)
 *   skips projection and rebuilds once afterwards.
 *
 * It is the rule `@worlds/libsql`, `@worlds/sqlite`, and `@worlds/cloudflare`
 * each implement today, differing only in the default mode.
 */
export function planSearchIndexing(
  mode: SearchIndexOnImport | undefined,
  context?: TransactionContext,
  options?: PlanSearchIndexingOptions,
): SearchIndexPlan {
  const effective = mode ?? options?.defaultMode ??
    DEFAULT_SEARCH_INDEX_ON_IMPORT;
  const deferredImport = effective === "deferred" && isImportCommit(context);
  return {
    projectDuringCommit: effective !== "disabled" && !deferredImport,
    reindexAfterCommit: deferredImport,
  };
}
