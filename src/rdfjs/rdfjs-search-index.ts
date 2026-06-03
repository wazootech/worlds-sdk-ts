import type * as rdfjs from "@rdfjs/types";
import type { Store } from "n3";
import type {
  ReindexRequest,
  ReindexResponse,
  SearchIndexInterface,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "@/client/search-index/mod.ts";
import { buildSearchResultId } from "@/client/search-index/build-search-result-id.ts";
import { filterQuads, isTextualLiteral } from "@/client/quad-store/mod.ts";

/**
 * RdfjsSearchIndex is the implementation of SearchIndexInterface that uses an RDF/JS store.
 */
export class RdfjsSearchIndex implements SearchIndexInterface {
  public constructor(
    private readonly store: Store,
  ) {}

  public async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query.toLowerCase();
    const stream = this.store.match(null, null, null, null);
    const results: Array<SearchResult> = [];
    const pendingSearchResultPromises: Array<Promise<void>> = [];

    // 🛡️ Pre-compile the centralized O(1) execution gate from the request payload
    const matcher = filterQuads(request);

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (quad: rdfjs.Quad) => {
        // 1. Evaluate Centralized Boundary Filters
        if (!matcher(quad)) {
          return;
        }

        // 2. Text Filter: Match ONLY canonical textual physical literals
        if (isTextualLiteral(quad.object)) {
          const value = quad.object.value;
          if (value.toLowerCase().includes(query)) {
            pendingSearchResultPromises.push((async () => {
              const searchResultBase = {
                subject: quad.subject.value,
                predicate: quad.predicate.value,
                graph: quad.graph.value,
                text: value,
              };
              results.push({
                id: await buildSearchResultId(searchResultBase),
                ...searchResultBase,
                score: 1.0,
              });
            })());
          }
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    await Promise.all(pendingSearchResultPromises);

    return { results };
  }

  /**
   * reindex is a no-op for in-memory RDF/JS search, which scans the live store on each query.
   */
  public reindex(_request?: ReindexRequest): Promise<ReindexResponse> {
    return Promise.resolve({
      processedQuadCount: this.store.size,
      chunkRowCount: 0,
    });
  }
}
