import type * as rdfjs from "@rdfjs/types";
import {
  hashQuad,
  isReplaceImportCommit,
  preparePatch,
  selectNovelQuads,
} from "@/client/quad-store/mod.ts";
import type { Patch, TransactionContext } from "@/client/quad-store/mod.ts";
import {
  planSearchIndexing,
  type SearchIndexOnImport,
} from "@/client/search-index/mod.ts";
import {
  chunkAndEmbedQuads,
  type TextSplitterInterface,
} from "@/client/search-index/quad-chunker/mod.ts";
import type {
  CommitConformanceCreateOptions,
  CommitConformanceSubject,
} from "./commit-conformance-types.ts";

/** wholeLiteral keeps each literal as one chunk. */
const wholeLiteral: TextSplitterInterface = {
  createDocuments: (texts, metadatas) =>
    Promise.resolve(
      texts.map((pageContent, i) => ({
        pageContent,
        metadata: metadatas?.[i],
      })),
    ),
};

/** ReferenceStoreOptions tunes the in-memory reference pipeline, including deliberate bugs. */
export interface ReferenceStoreOptions extends CommitConformanceCreateOptions {
  /** defaultMode is the backend's default `searchIndexOnImport`. */
  defaultMode?: SearchIndexOnImport;

  /** degradeOnEmbeddingFailure stores keyword-only chunks instead of rejecting. */
  degradeOnEmbeddingFailure?: boolean;

  /** bug makes the pipeline violate one rule, so the suite can be shown to catch it. */
  bug?:
    | "write-before-embed"
    | "orphan-chunks-on-failure"
    | "wipe-before-failure";
}

/**
 * createReferenceCommitStore is the shared commit pipeline over in-memory maps:
 * prepare, select novel quads, plan indexing, chunk and embed, then one write
 * that applies everything or nothing. It exists to prove the conformance suite
 * runs against the shared helpers; a backend replaces the maps with its SQL.
 */
export function createReferenceCommitStore(
  options: ReferenceStoreOptions,
): CommitConformanceSubject {
  const quads = new Map<string, rdfjs.Quad>();
  let chunks: string[] = [];
  let rebuilds = 0;
  let failArmed = false;

  const textChunks = async (batch: rdfjs.Quad[]) =>
    (await chunkAndEmbedQuads(batch, batch.map(hashQuad), {
      textSplitter: wholeLiteral,
      embeddingService: options.embeddingService,
      vectorDimensions: 32,
      onEmbeddingFailure: options.degradeOnEmbeddingFailure
        ? "degrade"
        : "throw",
    })).rows.map((row) => row.chunk.quad_id);

  const store = (quad: rdfjs.Quad) => quads.set(hashQuad(quad), quad);

  async function commit(patch: Patch, context?: TransactionContext) {
    const replacing = isReplaceImportCommit(context);
    const prepared = preparePatch(patch);
    const { novelInsertions } = await selectNovelQuads(prepared, {
      replacing,
      lookupExisting: (keys) =>
        Promise.resolve(new Set(keys.filter((key) => quads.has(key)))),
    });
    const plan = planSearchIndexing(options.searchIndexOnImport, context, {
      defaultMode: options.defaultMode,
    });
    if (options.bug === "write-before-embed") novelInsertions.forEach(store);
    const rows = plan.projectDuringCommit
      ? await textChunks(novelInsertions)
      : [];

    if (failArmed) {
      failArmed = false;
      if (options.bug === "orphan-chunks-on-failure") chunks.push(...rows);
      if (options.bug === "wipe-before-failure" && replacing) {
        quads.clear();
        chunks = [];
      }
      throw new Error("injected write failure");
    }
    if (replacing) {
      quads.clear();
      chunks = [];
    }
    for (const id of prepared.deletionIds) {
      quads.delete(id);
      chunks = chunks.filter((chunkId) => chunkId !== id);
    }
    for (const id of rows) chunks = chunks.filter((chunkId) => chunkId !== id);
    novelInsertions.forEach(store);
    chunks.push(...rows);
    if (plan.reindexAfterCommit) {
      chunks = await textChunks([...quads.values()]);
      rebuilds++;
    }
  }

  return {
    commit,
    storedQuads: () => Promise.resolve([...quads.values()]),
    chunkedQuadIds: () => Promise.resolve([...chunks]),
    failNextWrite: () => {
      failArmed = true;
    },
    fullRebuildCount: () => rebuilds,
  };
}
