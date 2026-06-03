import { Client } from "@/client/client.ts";
import type * as rdfjs from "@rdfjs/types";
import type { ClientInterface } from "@/client/client.ts";
import type { ComunicaQueryEngine } from "@/comunica/mod.ts";
import { ComunicaSparqlEngine } from "@/comunica/mod.ts";

import { DenokvRdfjsStore } from "./rdfjs-store/mod.ts";
import { DenokvSearchIndex } from "./search-index/mod.ts";
import { DenokvQuadStore } from "./quad-store/mod.ts";
import type { CommitPatchToDenokvOptions } from "./commit-patch-to-denokv.ts";
import type { SearchIndexOnImport } from "@/client/search-index/mod.ts";

/**
 * DenokvClientOptions specifies configuration parameters for Deno KV client contexts.
 */
export interface DenokvClientOptions extends CommitPatchToDenokvOptions {
  /** queryEngine optionally enables built-in Comunica SPARQL over DenokvRdfjsStore. */
  queryEngine?: ComunicaQueryEngine;

  /** searchIndexOnImport controls when search indexing runs. */
  searchIndexOnImport?: SearchIndexOnImport;

  /** reindex optionally triggers rebuilding external search indexes. */
  reindex?: () => Promise<void>;
}

/**
 * createDenokvClient synthesizes a Client over DenokvRdfjsStore.
 */
export function createDenokvClient(
  options: DenokvClientOptions,
): ClientInterface {
  const denokvRdfjsStore = new DenokvRdfjsStore({
    kv: options.kv,
    keyPrefix: options.keyPrefix,
    enabledQuadIndexes: options.enabledQuadIndexes,
  });

  const searchIndex = new DenokvSearchIndex({
    kv: options.kv,
    keyPrefix: options.keyPrefix,
  });

  const quadStore = new DenokvQuadStore({
    ...options,
    store: denokvRdfjsStore,
  });

  const sparqlEngine = options.queryEngine
    ? new ComunicaSparqlEngine({
      queryEngine: options.queryEngine,
      store: denokvRdfjsStore as unknown as rdfjs.Store,
      createTransaction: () => quadStore.createTransaction(),
    })
    : undefined;

  return new Client({
    quadStore,
    searchIndex,
    sparqlEngine,
  });
}
