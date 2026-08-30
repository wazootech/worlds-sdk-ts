import { type Client, reindexWorld, searchWorld } from "@worlds/client";
import type {
  ReindexRequest,
  ReindexResponse,
  SearchIndexInterface,
  SearchRequest,
  SearchResponse,
} from "@/client/search-index/mod.ts";

/**
 * RemoteSearchIndex implements SearchIndexInterface by delegating to the Worlds
 * data-plane API via @worlds/client.
 */
export class RemoteSearchIndex implements SearchIndexInterface {
  constructor(
    private readonly client: Client,
    private readonly worldId: string,
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const result = await searchWorld({
      client: this.client,
      path: { id: this.worldId },
      body: {
        query: request.query,
        topK: request.topK,
        minScore: request.minScore,
      },
    });

    if (result.error) {
      throw new Error(
        `Search failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }

    return {
      results: result.data.results.map((r) => ({
        id: `${r.subject}#${r.predicate}`,
        subject: r.subject,
        predicate: r.predicate,
        graph: r.graph ?? "",
        text: r.content ?? "",
        score: r.score ?? 0,
      })),
    };
  }

  async reindex(_request?: ReindexRequest): Promise<ReindexResponse> {
    const result = await reindexWorld({
      client: this.client,
      path: { id: this.worldId },
    });

    if (result.error) {
      throw new Error(
        `Reindex failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }

    // The API returns { ok, status } but the SDK interface expects
    // { processedQuadCount, chunkRowCount }. The server-side reindex is
    // opaque, so we return 0 for both counts — the caller only cares
    // that it succeeded.
    return {
      processedQuadCount: 0,
      chunkRowCount: 0,
    };
  }
}
