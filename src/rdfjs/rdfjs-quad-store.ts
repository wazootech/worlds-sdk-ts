import type * as rdfjs from "@rdfjs/types";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "@/client/quad-store/mod.ts";
import {
  createRdfjsStoreCommitHandler,
  exportFromRdfjsStore,
  importViaTransaction,
  Transaction,
} from "@/client/quad-store/mod.ts";
import * as N3 from "n3";

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
}

/**
 * RdfjsQuadStore is the standard implementation of the QuadStoreInterface that uses
 * an underlying in-memory or compatible RDFJS Store.
 */
export class RdfjsQuadStore implements QuadStoreInterface {
  private readonly store: rdfjs.Store;

  public constructor(private readonly options?: RdfjsQuadStoreOptions) {
    this.store = options?.store ?? new N3.Store();
  }

  public async import(request: ImportRequest): Promise<void> {
    const commitHandler = this.options?.commit ??
      createRdfjsStoreCommitHandler(this.store);
    await importViaTransaction(request, {
      createTransaction: () =>
        new Transaction({
          commit: commitHandler,
        }),
    });
  }

  public async export(request: ExportRequest): Promise<ExportResponse> {
    return await exportFromRdfjsStore(this.store, request);
  }
}
