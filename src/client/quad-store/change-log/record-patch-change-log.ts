import type * as rdfjs from "@rdfjs/types";
import type { Patch } from "../patch.ts";
import type { TransactionContext } from "../transaction-context.ts";
import { hashQuad } from "../hash-quad.ts";
import type { ChangeLogEntry, ChangeLogStore } from "./change-log-store.ts";

/**
 * recordPatchChangeLog records change-log entries for one applied patch:
 * removal entries for deletions and prior quads, and add entries for
 * insertions. The actor is the patch context writer and the source is the
 * patch context source, both supplied on import. Durable backends call this
 * inside the same database transaction as the mutation so the log row and
 * the quad mutation land or fail together; the in-memory caller records the
 * log only after the commit handler succeeds.
 */
export async function recordPatchChangeLog(
  options: RecordPatchChangeLogOptions,
): Promise<ChangeLogEntry[]> {
  const {
    changeLogStore,
    patch,
    context,
    transactionId,
    recordedAt = new Date().toISOString(),
    priorQuads = [],
  } = options;
  const actor = context?.provenance?.writer;
  const source = context?.provenance?.source;
  const insertionIds = new Set<string>();
  for (const quad of patch.insertions) {
    const quadId = safeHashQuad(quad);
    if (quadId !== null) insertionIds.add(quadId);
  }
  const removedQuads = [...patch.deletions, ...priorQuads].filter((quad) => {
    const quadId = safeHashQuad(quad);
    return quadId !== null && !insertionIds.has(quadId);
  });
  const recordedEntries: ChangeLogEntry[] = [];
  for (const removedQuad of removedQuads) {
    recordedEntries.push(
      await changeLogStore.record({
        transactionId,
        recordedAt,
        operation: "remove",
        quadId: hashQuad(removedQuad),
        quad: removedQuad,
        actor,
        source,
      }),
    );
  }
  for (const quad of patch.insertions) {
    const quadId = safeHashQuad(quad);
    if (quadId === null) continue;
    recordedEntries.push(
      await changeLogStore.record({
        transactionId,
        recordedAt,
        operation: "add",
        quadId,
        quad,
        actor,
        source,
      }),
    );
  }
  return recordedEntries;
}

/**
 * safeHashQuad returns null instead of throwing for quads the q2 scheme
 * cannot content-address (for example RDF-star triple terms); those quads
 * simply carry no change-log entry rather than failing the import.
 */
function safeHashQuad(quad: rdfjs.Quad): string | null {
  try {
    return hashQuad(quad);
  } catch {
    return null;
  }
}

/**
 * RecordPatchChangeLogOptions bundles the inputs to recordPatchChangeLog.
 */
export interface RecordPatchChangeLogOptions {
  changeLogStore: ChangeLogStore;
  patch: Patch;
  context?: TransactionContext;
  /** transactionId groups every entry written by one transaction commit. */
  transactionId: string;
  /** recordedAt defaults to the commit time when omitted. */
  recordedAt?: string;
  /** priorQuads are the quads that existed before a replace-mode wipe. */
  priorQuads?: rdfjs.Quad[];
}
