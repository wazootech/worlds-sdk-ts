import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "./quad-store/mod.ts";
import type {
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
} from "./sparql-engine/mod.ts";
import type {
  ReindexRequest,
  ReindexResponse,
  SearchIndexInterface,
  SearchRequest,
  SearchResponse,
} from "./search-index/mod.ts";

/**
 * WorldsSdkInterface is the public contract for the Worlds SDK.
 */
export interface WorldsSdkInterface {
  /**
   * import imports data into the Worlds API.
   * @param request The import request body.
   * @returns A promise that resolves when import completes.
   */
  import(request: ImportRequest): Promise<void>;

  /**
   * export exports data from the Worlds API.
   * @param request The export request body.
   * @returns A promise that resolves to the export response.
   */
  export(request: ExportRequest): Promise<ExportResponse>;

  /**
   * sparql executes a SPARQL query or update against the RDF store.
   * @param request The SPARQL request body.
   * @returns A promise that resolves to the SPARQL response.
   */
  sparql(request: SparqlRequest): Promise<SparqlResponse>;

  /**
   * search searches the RDF store for the given query.
   * @param request The search request body.
   * @returns A promise that resolves to the search response.
   */
  search(request: SearchRequest): Promise<SearchResponse>;

  /**
   * reindex rebuilds the derived search index from durable quads.
   * On scan topologies, reindex is a documented, safe no-op.
   * @param request optional include/exclude scope and read page size.
   * @returns A promise that resolves to processed quad and chunk row counts.
   */
  reindex(request?: ReindexRequest): Promise<ReindexResponse>;
}

/**
 * WorldsSdkOptions wires quad, SPARQL, and search facades for custom assembly and tests.
 */
export interface WorldsSdkOptions {
  /** quadStore manages the ingestion and extraction of triple/quad data. */
  quadStore?: QuadStoreInterface;

  /** sparqlEngine evaluates declarative queries and updates against the graph. */
  sparqlEngine?: SparqlEngineInterface;

  /** searchIndex enables high-performance keyword search across the graph literals. */
  searchIndex?: SearchIndexInterface;
}

/**
 * WorldsSdk synthesizes a Worlds SDK facade from wired quad, SPARQL, and search subsystems.
 */
export class WorldsSdk implements WorldsSdkInterface {
  public constructor(
    private readonly options: WorldsSdkOptions,
  ) {}

  public import(request: ImportRequest): Promise<void> {
    if (!this.options.quadStore) {
      throw new Error("Quad store is not configured.");
    }
    return this.options.quadStore.import(request);
  }

  public export(request: ExportRequest): Promise<ExportResponse> {
    if (!this.options.quadStore) {
      throw new Error("Quad store is not configured.");
    }
    return this.options.quadStore.export(request);
  }

  public async sparql(request: SparqlRequest): Promise<SparqlResponse> {
    if (!this.options.sparqlEngine) {
      throw new Error("SPARQL engine is not configured.");
    }
    return await this.options.sparqlEngine.execute(request);
  }

  public search(request: SearchRequest): Promise<SearchResponse> {
    if (!this.options.searchIndex) {
      throw new Error("Search index is not configured.");
    }
    return this.options.searchIndex.search(request);
  }

  public reindex(request?: ReindexRequest): Promise<ReindexResponse> {
    if (!this.options.searchIndex) {
      throw new Error("Search index is not configured.");
    }
    return this.options.searchIndex.reindex(request);
  }
}
