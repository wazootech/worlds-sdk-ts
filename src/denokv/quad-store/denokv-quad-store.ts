import type * as rdfjs from "@rdfjs/types";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "@/client/quad-store/mod.ts";
import {
  exportFromRdfjsStore,
  importViaTransaction,
  Transaction,
} from "@/client/quad-store/mod.ts";
import type { DenokvRdfjsStore } from "../rdfjs-store/mod.ts";
import type { SearchIndexOnImport } from "@/client/search-index/mod.ts";
import {
  commitPatchToDenokv,
  type CommitPatchToDenokvOptions,
} from "../commit-patch-to-denokv.ts";

/**
 * DenokvQuadStoreOptions configures DenokvQuadStore dependencies and sync settings.
 */
export interface DenokvQuadStoreOptions extends CommitPatchToDenokvOptions {
  /** store is the underlying Deno KV RDF/JS ReadSource store. */
  store: DenokvRdfjsStore;

  /** searchIndexOnImport controls when search indexing runs. */
  searchIndexOnImport?: SearchIndexOnImport;

  /** reindex optionally triggers rebuilding external search indexes. */
  reindex?: () => Promise<void>;
}

/**
 * DenokvQuadStore implements the QuadStoreInterface for Deno KV backed durable persistence.
 * It encapsulates transaction routing, commits, and indexing synchronization.
 */
export class DenokvQuadStore implements QuadStoreInterface {
  public constructor(
    private readonly options: DenokvQuadStoreOptions,
  ) {}

  /**
   * import merges or replaces the underlying store with provided RDF source data.
   *
   * @param request The payload defining the ingestion source and overwrite mode.
   */
  public async import(request: ImportRequest): Promise<void> {
    await importViaTransaction(request, {
      createTransaction: () => this.createTransaction(),
    });
  }

  /**
   * export extracts the graph contents in raw quads or serialized formats.
   *
   * @param request The desired format specifications.
   */
  public async export(request: ExportRequest): Promise<ExportResponse> {
    return await exportFromRdfjsStore(
      this.options.store as unknown as rdfjs.Store,
      request,
    );
  }

  /**
   * createTransaction returns a pre-configured Transaction bound to internal commit hooks.
   */
  public createTransaction(): Transaction {
    return new Transaction({
      commit: async (patch, context) => {
        const searchIndexOnImport = this.options.searchIndexOnImport ??
          "incremental";

        await commitPatchToDenokv(patch, this.options, context);

        const isImport = context?.importMode !== undefined;
        if (
          isImport && searchIndexOnImport === "deferred" && this.options.reindex
        ) {
          await this.options.reindex();
        }
      },
    });
  }
}
