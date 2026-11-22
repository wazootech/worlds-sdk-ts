import type * as rdfjs from "@rdfjs/types";
import {
  isReplaceImportCommit,
  type NovelQuads,
  type Patch,
  type PreparedPatch,
  preparePatch,
  type QuadFilter,
  selectNovelQuads,
  type TransactionContext,
} from "@/client/quad-store/mod.ts";
import type { SearchIndexOnImport } from "./search-index-interface.ts";
import {
  planSearchIndexing,
  type SearchIndexPlan,
} from "./search-index-policy.ts";
import {
  type ChunkAndEmbedOptions,
  chunkAndEmbedQuads,
  type EmbeddedChunk,
} from "./quad-chunker/chunk-and-embed.ts";

/** PrepareCommitOptions configures everything a commit does before its first write. */
export interface PrepareCommitOptions extends QuadFilter {
  /** context is the commit's transaction context (import mode); absent for an ordinary commit. */
  context?: TransactionContext;

  /** searchIndexOnImport is the configured mode; unset falls back to `defaultMode`. */
  searchIndexOnImport?: SearchIndexOnImport;

  /** defaultMode is the backend's own default mode (see PlanSearchIndexingOptions). */
  defaultMode?: SearchIndexOnImport;

  /** lookupExisting returns which of the given keys the store already holds. */
  lookupExisting: (keys: string[]) => Promise<Set<string>>;

  /** keyOf is the store's identity for a quad; defaults to the content hash. */
  keyOf?: (quad: rdfjs.Quad, id: string) => string;

  /**
   * projection chunks and embeds the novel quads when the plan projects during
   * the commit. Without it `rows` is always empty.
   */
  projection?: ChunkAndEmbedOptions;

  /**
   * selectNovel says when to look up what the store holds. "always" (default)
   * selects novel quads on every commit, for a backend that writes only the
   * novel quads. "when-projecting" selects them only when `rows` will be
   * produced, for a backend whose store deduplicates writes itself and needs
   * novel quads only to project them; otherwise `novel` is empty and no
   * lookup is made.
   */
  selectNovel?: "always" | "when-projecting";
}

/** PreparedCommit is everything a backend needs to write one commit. */
export interface PreparedCommit {
  /** prepared is the patch after the filter, with content hashes; write these, not the raw patch. */
  prepared: PreparedPatch;

  /** plan says whether to project in this commit and whether to rebuild after it. */
  plan: SearchIndexPlan;

  /** novel are the filtered insertions the store did not hold (or the patch also deletes). */
  novel: NovelQuads;

  /** rows are the chunk rows to write; empty when the plan skips projection or nothing is textual. */
  rows: EmbeddedChunk[];

  /** replacing is true for a replace-mode import: the backend wipes before it writes. */
  replacing: boolean;
}

/**
 * prepareCommit is the pure, fallible half of every durable commit, in the one
 * order all backends share, entirely before any write:
 *
 * 1. `preparePatch` applies the include/exclude filter to both sides, so a
 *    filtered-out quad is neither stored nor projected, and hashes the rest.
 * 2. `planSearchIndexing` decides whether to project now and whether a full
 *    rebuild must follow (a deferred import projects nothing: `rows` is empty
 *    and the caller reindexes after its write).
 * 3. `selectNovelQuads` finds the insertions to write (see `selectNovel`).
 * 4. `chunkAndEmbedQuads` builds the chunk rows for the novel quads. A chunking
 *    or embedding failure rejects here, so the store is never touched.
 *
 * The caller writes `prepared` deletions, `novel` insertions, and `rows`, wipes
 * first when `replacing`, then reindexes when `plan.reindexAfterCommit`.
 */
export async function prepareCommit(
  patch: Patch,
  options: PrepareCommitOptions,
): Promise<PreparedCommit> {
  const { context, projection } = options;
  const replacing = isReplaceImportCommit(context);
  const prepared = preparePatch(patch, {
    include: options.include,
    exclude: options.exclude,
  });
  const plan = planSearchIndexing(options.searchIndexOnImport, context, {
    defaultMode: options.defaultMode,
  });
  const projecting = plan.projectDuringCommit ? projection : undefined;
  const novel = options.selectNovel === "when-projecting" && !projecting
    ? { novelInsertions: [], novelQuadIds: [] }
    : await selectNovelQuads(prepared, {
      replacing,
      keyOf: options.keyOf,
      lookupExisting: options.lookupExisting,
    });
  const rows = projecting && novel.novelQuadIds.length > 0
    ? (await chunkAndEmbedQuads(
      novel.novelInsertions,
      novel.novelQuadIds,
      projecting,
    )).rows
    : [];
  return { prepared, plan, novel, rows, replacing };
}
