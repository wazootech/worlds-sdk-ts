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
import type { LibsqlClientBaseOptions } from "../libsql-client-base-options.ts";
import type { LibsqlRdfjsStore } from "../rdfjs-store/mod.ts";
import type { LibsqlSearchQueryBuilder } from "../search-index/libsql-search-query-builder.ts";
import type { LibsqlSearchIndexProjector } from "../search-index/mod.ts";
import { commitPatchToLibsql } from "../commit-patch-to-libsql.ts";

/**
 * LibsqlQuadStoreOptions defines the configurations for the LibsqlQuadStore.
 */
export interface LibsqlQuadStoreOptions extends LibsqlClientBaseOptions {
  /** store is the underlying LibSQL RDF/JS ReadSource store. */
  store: LibsqlRdfjsStore;

  /** searchQueryBuilder supplies dimension-aware SQL used for deletions, inserts, and chunk replication. */
  searchQueryBuilder: LibsqlSearchQueryBuilder;

  /** searchIndexProjector manages vector embedding and text chunk synchronisation. */
  searchIndexProjector?: LibsqlSearchIndexProjector;

  /** maxWriteBatchSize caps how many statements are sent per LibSQL write batch. Defaults to 500. */
  maxWriteBatchSize?: number;
}

/**
 * LibsqlQuadStore implements the QuadStoreInterface for LibSQL backed durable persistence.
 * It encapsulates transaction routing, commits, and indexing synchronization.
 */
export class LibsqlQuadStore implements QuadStoreInterface {
  public constructor(
    private readonly options: LibsqlQuadStoreOptions,
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
        const isImport = context?.importMode !== undefined;
        const searchIndexOnImport = this.options.searchIndexOnImport ??
          "incremental";
        const skipSearchIndexProjection =
          this.options.searchIndexOnImport === "disabled" ||
          (isImport && searchIndexOnImport === "deferred");

        const { novelInsertions, novelQuadIds, labelTouchedSubjects } =
          await commitPatchToLibsql(
            patch,
            this.options,
            context,
          );

        if (!skipSearchIndexProjection && this.options.searchIndexProjector) {
          await this.options.searchIndexProjector.projectNovelQuads(
            novelInsertions,
            novelQuadIds,
            labelTouchedSubjects,
          );
        }

        if (
          isImport && searchIndexOnImport === "deferred" &&
          this.options.searchIndexProjector
        ) {
          await this.options.searchIndexProjector.reindexAll();
        }
      },
    });
  }
}
