import type * as rdfjs from "@rdfjs/types";
import type { TransactionContext } from "@/client/quad-store/mod.ts";

/**
 * createRdfjsStoreCommitHandler returns a commit function that applies Patches
 * directly to an underlying rdfjs.Store by using its native add/delete/remove methods.
 * For robust usage, the underlying store should support synchronous add/delete.
 */
export function createRdfjsStoreCommitHandler(
  store: rdfjs.Store,
): (
  patch: import("./patch.ts").Patch,
  context?: TransactionContext,
) => Promise<void> {
  return async (patch, context) => {
    // If the store supports native applyPatch, use it to avoid quad-at-a-time loop overhead
    if (
      "applyPatch" in store &&
      typeof (store as Record<string, unknown>).applyPatch === "function"
    ) {
      return (store as unknown as import("./transaction-context.ts").PatchableStore)
        .applyPatch(patch, context);
    }

    if (context?.importMode === "replace") {
      const stream = store.match(null, null, null, null);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (quad: rdfjs.Quad) => {
          if (
            "removeQuad" in store && typeof store.removeQuad === "function"
          ) {
            store.removeQuad(quad);
          } else if (
            "delete" in store && typeof store.delete === "function"
          ) {
            store.delete(quad);
          }
        });
        stream.on("end", resolve);
        stream.on("error", reject);
      });
    }

    // Some stores like N3.Store support addQuad/removeQuad synchronously,
    // while the standard generic rdfjs.Store specifies add(quad) / delete(quad)
    for (const quad of patch.deletions) {
      if ("removeQuad" in store && typeof store.removeQuad === "function") {
        store.removeQuad(quad);
      } else if ("delete" in store && typeof store.delete === "function") {
        store.delete(quad);
      }
    }

    for (const quad of patch.insertions) {
      if ("addQuad" in store && typeof store.addQuad === "function") {
        store.addQuad(quad);
      } else if ("add" in store && typeof store.add === "function") {
        store.add(quad);
      }
    }
    return Promise.resolve();
  };
}
