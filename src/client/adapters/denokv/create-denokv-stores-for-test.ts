import type * as rdfjs from "@rdfjs/types";

import {
  DenokvQuadStore,
  type DenokvQuadStoreOptions,
} from "./quad-store/mod.ts";
import { DenokvRdfjsStore } from "./rdfjs-store/mod.ts";

/**
 * DenokvStoresForTest bundles Deno KV quad and RDF/JS store facades for adapter tests.
 */
export interface DenokvStoresForTest {
  /** denokvQuadStore serves Client import and export in tests. */
  denokvQuadStore: DenokvQuadStore;

  /** denokvRdfjsStore serves Comunica SPARQL match and buffered updates in tests. */
  denokvRdfjsStore: DenokvRdfjsStore;
}

/**
 * createDenokvStoresForTest wires shared DenokvRdfjsStore and BufferedRdfjsQuadStore instances for tests.
 */
export function createDenokvStoresForTest(
  options: Omit<DenokvQuadStoreOptions, "store">,
): DenokvStoresForTest {
  const denokvRdfjsStore = new DenokvRdfjsStore({
    kv: options.kv,
    keyPrefix: options.keyPrefix,
    enabledQuadIndexes: options.enabledQuadIndexes,
  });
  const denokvQuadStore = new DenokvQuadStore({
    ...options,
    store: denokvRdfjsStore,
  });

  return { denokvQuadStore, denokvRdfjsStore };
}

/**
 * seedDenokvQuadsForTest persists quads into an in-memory Deno Kv instance for adapter tests.
 */
export async function seedDenokvQuadsForTest(
  kv: Deno.Kv,
  quads: rdfjs.Quad[],
  options?: Omit<DenokvQuadStoreOptions, "store" | "kv">,
): Promise<void> {
  const { denokvQuadStore } = createDenokvStoresForTest({ kv, ...options });
  await denokvQuadStore.import({
    mode: "merge",
    source: { kind: "quads", quads },
  });
}
