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
import type { Quad } from "@/client/quad-store/mod.ts";
import { toRdfjsQuad } from "@/client/quad-store/mod.ts";
import { buildGenerationDataPrefix } from "@/denokv/kv/denokv-keys.ts";
import { readActiveGeneration } from "@/denokv/kv/denokv-dataset-generation.ts";

/**
 * DenokvSearchIndexOptions provides configurations for operating direct Kv search scans.
 */
export interface DenokvSearchIndexOptions {
  /** kv is the target Deno Kv instance holding the persistent quads. */
  kv: Deno.Kv;

  /** keyPrefix restricts target dataset range iteration, defaults to ["quads"]. */
  keyPrefix?: Deno.KvKey;
}

/**
 * DenokvSearchIndex implements keyword search by scanning quads in the active dataset generation.
 * Each entry is deserialized and matched with a naive case-insensitive includes() check.
 * This avoids building a full in-memory N3 graph (unlike SPARQL hydration) but is O(N)
 * per query with no index and no early exit when a match is found.
 */
export class DenokvSearchIndex implements SearchIndexInterface {
  public constructor(
    private readonly options: DenokvSearchIndexOptions,
  ) {}

  public async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query.toLowerCase();
    const keyPrefix = this.options.keyPrefix ?? ["quads"];
    const results: Array<SearchResult> = [];

    const matcher = filterQuads(request);

    const generationId = await readActiveGeneration(
      this.options.kv,
      keyPrefix,
    );
    const scopedDataPrefix = buildGenerationDataPrefix(
      keyPrefix,
      generationId,
    );

    const quadIter = this.options.kv.list<Quad>({
      prefix: [...scopedDataPrefix, "quads"],
    });

    for await (const entry of quadIter) {
      const serialized = entry.value;
      if (!serialized) continue;

      const storedQuad = toRdfjsQuad(serialized);

      if (!matcher(storedQuad)) {
        continue;
      }

      if (isTextualLiteral(storedQuad.object)) {
        const value = storedQuad.object.value;
        if (value.toLowerCase().includes(query)) {
          const searchResultBase = {
            subject: storedQuad.subject.value,
            predicate: storedQuad.predicate.value,
            graph: storedQuad.graph.value,
            text: value,
          };
          results.push({
            id: await buildSearchResultId(searchResultBase),
            ...searchResultBase,
            score: 1.0,
          });
        }
      }
    }

    return { results };
  }

  /**
   * reindex is a no-op for Deno KV search, which scans quads at query time.
   */
  public reindex(_request?: ReindexRequest): Promise<ReindexResponse> {
    return Promise.resolve({
      processedQuadCount: 0,
      chunkRowCount: 0,
    });
  }
}
