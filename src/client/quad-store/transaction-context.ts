import type * as rdfjs from "@rdfjs/types";

import type { ImportMode } from "./quad-store-interface.ts";
import type { Patch } from "./patch.ts";
import type { ImportProvenance } from "./provenance/mod.ts";

/**
 * TransactionContext carries optional metadata for a buffered commit flush.
 */
export interface TransactionContext {
  /** importMode signals bulk import replace semantics to durable commit handlers. */
  importMode?: ImportMode;

  /** provenance carries the import's writer/source metadata to provenance-recording commit handlers. */
  provenance?: ImportProvenance;
}

/**
 * PatchableStore is an RDFJS store that natively supports atomic bulk-mutations via Patches.
 */
export interface PatchableStore extends rdfjs.Store {
  /** applyPatch persists a patch atomically. */
  applyPatch(patch: Patch, context?: TransactionContext): Promise<void>;
}

/**
 * isImportCommit returns true when commit context carries bulk import semantics.
 */
export function isImportCommit(context?: TransactionContext): boolean {
  return context?.importMode !== undefined;
}

/**
 * isReplaceImportCommit returns true when commit context requests replace import semantics.
 */
export function isReplaceImportCommit(context?: TransactionContext): boolean {
  return context?.importMode === "replace";
}

/**
 * deduplicateBuffers removes quads that appear in both insert and delete buffers.
 */
export function deduplicateBuffers(
  insertBuffer: rdfjs.Quad[],
  deleteBuffer: rdfjs.Quad[],
): void {
  const removeFromInsert: number[] = [];
  for (
    let insertIndex = insertBuffer.length - 1;
    insertIndex >= 0;
    insertIndex--
  ) {
    for (
      let deleteIndex = deleteBuffer.length - 1;
      deleteIndex >= 0;
      deleteIndex--
    ) {
      if (insertBuffer[insertIndex].equals(deleteBuffer[deleteIndex])) {
        removeFromInsert.push(insertIndex);
        deleteBuffer.splice(deleteIndex, 1);
        break;
      }
    }
  }
  for (const insertIndex of removeFromInsert) {
    insertBuffer.splice(insertIndex, 1);
  }
}
