import type * as rdfjs from "@rdfjs/types";

import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
} from "@/client/quad-store/quad-store-interface.ts";
import {
  collectQuadsFromStream,
  exportQuadsResponse,
  materializeImportQuads,
} from "@/client/quad-store/rdf-formats.ts";

import type { Transaction } from "./transaction.ts";

/**
 * ImportViaBufferedRdfjsStoreOptions configures durable import over a Transaction.
 */
export interface ImportViaTransactionOptions {
  /** createTransaction yields a scoped mutation interceptor (Transaction). */
  createTransaction: () => Transaction;
}

/**
 * importViaTransaction drains an ImportRequest directly into a transactional patch.
 */
export async function importViaTransaction(
  request: ImportRequest,
  options: ImportViaTransactionOptions,
): Promise<void> {
  const mode = request.mode ?? "merge";
  const quads = await materializeImportQuads(request.source);

  const tx = options.createTransaction();
  try {
    for (const quad of quads) {
      tx.addQuad(quad);
    }
    await tx.commit({ importMode: mode, provenance: request.provenance });
  } catch (error) {
    tx.rollback();
    throw error;
  }
}

/**
 * RdfjsExportSource is the minimal RDF/JS surface required for quad export.
 */
export type RdfjsExportSource = Pick<rdfjs.Store, "match">;

/**
 * exportFromRdfjsStore streams all quads from an RDF/JS store and serializes the export response.
 */
export async function exportFromRdfjsStore(
  rdfjsStore: RdfjsExportSource,
  request: ExportRequest,
): Promise<ExportResponse> {
  const stream = rdfjsStore.match(null, null, null, null);
  const quads = await collectQuadsFromStream(stream);
  return await exportQuadsResponse(quads, request);
}
