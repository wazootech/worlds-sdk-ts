import type * as rdfjs from "@rdfjs/types";
import type {
  Patch,
  ProvenanceStore,
  TransactionContext,
} from "@/client/quad-store/mod.ts";
import { hashQuad } from "@/client/quad-store/mod.ts";

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
  patch: Patch;
  context?: TransactionContext;
  /** priorQuads are the quads that existed before a replace-mode wipe. */
  priorQuads?: rdfjs.Quad[];
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
