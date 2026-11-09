import type * as rdfjs from "@rdfjs/types";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "@/client/quad-store/mod.ts";
import type { TransactionContext } from "@/client/quad-store/mod.ts";
import {
  collectQuadsFromStream,
  createRdfjsStoreCommitHandler,
  exportFromRdfjsStore,
  hashQuad,
  importViaTransaction,
  InMemoryProvenanceStore,
  Transaction,
} from "@/client/quad-store/mod.ts";
import { MemoryStore } from "@wazoo/sparql-engine";
import type {
  ProvenanceQueryRequest,
  ProvenanceQueryResponse,
  ProvenanceStore,
} from "@/client/quad-store/mod.ts";

/**
 * RdfjsQuadStoreOptions configures RdfjsQuadStore dependencies.
 */
export interface RdfjsQuadStoreOptions {
  /** store is the active in-memory quad backend. */
  store?: rdfjs.Store;

  /** commit optionally overrides how transactions are persisted. */
  commit?: (
    patch: import("@/client/quad-store/mod.ts").Patch,
    context?: import("@/client/quad-store/mod.ts").TransactionContext,
  ) => Promise<void>;

  /**
   * provenanceStore optionally overrides the sidecar provenance store.
   * Defaults to an InMemoryProvenanceStore scoped to this store instance.
   */
  provenanceStore?: ProvenanceStore;
}

/**
 * RdfjsQuadStore is the standard implementation of the QuadStoreInterface that uses
 * an underlying in-memory or compatible RDFJS Store. Every commit records
 * sidecar provenance: write records for insertions, removal tombstones for
 * deletions and replace-mode wipes, and supersedesQuadId links when a commit
 * replaces a quad sharing subject, predicate, and graph.
 */
export class RdfjsQuadStore implements QuadStoreInterface {
  public readonly provenanceStore: ProvenanceStore;

  private readonly store: rdfjs.Store;

  public constructor(private readonly options?: RdfjsQuadStoreOptions) {
    this.store = options?.store ?? new MemoryStore();
    this.provenanceStore = options?.provenanceStore ??
      new InMemoryProvenanceStore();
  }

  public async import(request: ImportRequest): Promise<void> {
    const commitHandler = this.options?.commit ??
      createRdfjsStoreCommitHandler(this.store);
    await importViaTransaction(request, {
      createTransaction: () =>
        new Transaction({
          commit: async (patch, context) => {
            const priorQuads = context?.importMode === "replace"
              ? await collectAllQuads(this.store)
              : [];
            await commitHandler(patch, context);
            await this.recordProvenance(patch, context, priorQuads);
          },
        }),
    });
  }

  public async export(request: ExportRequest): Promise<ExportResponse> {
    return await exportFromRdfjsStore(this.store, request);
  }

  /**
   * provenanceQuery resolves quads matching the RDF pattern and pairs each
   * with its sidecar records and supersedes chain. Quads written before
   * provenance recording return with empty records rather than failing.
   */
  public async provenanceQuery(
    request: ProvenanceQueryRequest,
  ): Promise<ProvenanceQueryResponse> {
    const stream = this.store.match(
      request.subject ?? null,
      request.predicate ?? null,
      request.object ?? null,
    );
    const quads = await collectQuadsFromStream(stream);
    const results = await Promise.all(
      quads.map(async (quad) => {
        const quadId = hashQuad(quad);
        return {
          quadId,
          quad,
          records: await this.provenanceStore.list({ quadId }),
          history: await this.provenanceStore.history(quadId),
        };
      }),
    );
    return { results };
  }

  private recordProvenance(
    patch: import("@/client/quad-store/mod.ts").Patch,
    context?: TransactionContext,
    priorQuads: rdfjs.Quad[] = [],
  ): Promise<void> {
    return recordPatchProvenance({
      provenanceStore: this.provenanceStore,
      patch,
      context,
      priorQuads,
    });
  }
}

/**
 * recordPatchProvenance records sidecar provenance for one applied patch:
 * removal tombstones for deletions and prior quads, write records for
 * insertions, and supersedesQuadId links when an inserted quad occupies the
 * same subject/predicate/object/graph position as a removed one. Durable
 * backends and custom commit handlers (for example SPARQL update commits) can
 * call this directly so patch-driven removals are recorded too.
 */
export async function recordPatchProvenance(
  options: RecordPatchProvenanceOptions,
): Promise<void> {
  const { provenanceStore, patch, context, priorQuads = [] } = options;
  const meta = context?.provenance;
  const insertionIds = new Set<string>();
  for (const quad of patch.insertions) {
    const quadId = safeHashQuad(quad);
    if (quadId !== null) insertionIds.add(quadId);
  }
  const removedQuads = [...patch.deletions, ...priorQuads]
    .filter((quad) => {
      const quadId = safeHashQuad(quad);
      return quadId !== null && !insertionIds.has(quadId);
    });
  const supersededBySpog = new Map(
    removedQuads.map((quad) => [spogKey(quad), hashQuad(quad)]),
  );
  const recordedAt = new Date().toISOString();
  for (const removedQuad of removedQuads) {
    await provenanceStore.record({
      quadId: hashQuad(removedQuad),
      type: "remove",
      recordedAt,
      ...meta,
    });
  }
  for (const quad of patch.insertions) {
    const quadId = safeHashQuad(quad);
    if (quadId === null) continue;
    await provenanceStore.record({
      quadId,
      type: "write",
      recordedAt,
      supersedesQuadId: supersededBySpog.get(spogKey(quad)),
      ...meta,
    });
  }
}

/**
 * safeHashQuad returns null instead of throwing for quads the q2 scheme
 * cannot content-address (for example RDF-star triple terms); those quads
 * simply carry no provenance record rather than failing the import.
 */
function safeHashQuad(quad: rdfjs.Quad): string | null {
  try {
    return hashQuad(quad);
  } catch {
    return null;
  }
}

/**
 * RecordPatchProvenanceOptions bundles the inputs to recordPatchProvenance.
 */
export interface RecordPatchProvenanceOptions {
  provenanceStore: ProvenanceStore;
  patch: import("@/client/quad-store/mod.ts").Patch;
  context?: TransactionContext;
  /** priorQuads are the quads that existed before a replace-mode wipe. */
  priorQuads?: rdfjs.Quad[];
}

/**
 * collectAllQuads drains every quad currently in the store.
 */
async function collectAllQuads(store: rdfjs.Store): Promise<rdfjs.Quad[]> {
  return await collectQuadsFromStream(store.match(null, null, null, null));
}

/**
 * spogKey keys a quad by subject, predicate, and graph value so a removed
 * quad can be linked as superseded by an inserted quad in the same statement
 * position. The object is deliberately excluded: a correction keeps its
 * subject and predicate and changes the object, which is exactly the
 * supersession relationship provenance should capture.
 */
function spogKey(quad: rdfjs.Quad): string {
  return [
    quad.subject.value,
    quad.predicate.value,
    quad.graph.value,
  ].join("\u0000");
}
