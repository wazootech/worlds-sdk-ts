import { createClient } from "@libsql/client";
import { LibsqlSearchIndex } from "@/libsql/search-index/libsql-search-index.ts";
import { FakeEmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import {
  setupLibsqlSchemaForTest,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

// Setup Failing Embedding Service to test graceful fallback
class FailingEmbeddingService implements EmbeddingService {
  public embed(_texts: string[]): Promise<Array<Float32Array>> {
    return Promise.reject(
      new Error("Simulated network timeout/offline service."),
    );
  }
}

const databaseClient = createClient({ url: ":memory:" });
await setupLibsqlSchemaForTest(databaseClient);

const vectorArray = new Array(32).fill(0);
vectorArray[0] = 1.0;
const vectorJsonString = JSON.stringify(vectorArray);

// Insert sample chunk rows for testing
for (let index = 0; index < 1000; index++) {
  await databaseClient.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      `id-${index}`,
      `urn:entity:${index}`,
      "urn:property:name",
      "urn:graph:main",
      `Document payload text index ${index} with unique keywords.`,
      `Document payload text index ${index} with unique keywords.`,
      vectorJsonString,
    ],
  });
}

const ftsSearchIndex = new LibsqlSearchIndex({
  client: databaseClient,
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

const hybridSearchIndex = new LibsqlSearchIndex({
  client: databaseClient,
  embeddingService: new FakeEmbeddingService(),
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

const fallbackSearchIndex = new LibsqlSearchIndex({
  client: databaseClient,
  embeddingService: new FailingEmbeddingService(),
  searchQueryBuilder: testLibsqlSearchQueryBuilder,
});

// -----------------------------------------------------------------------------
// HYBRID SEARCH BENCHMARKS
// -----------------------------------------------------------------------------

Deno.bench({
  name: "Search: FTS5 Keyword-Only Search (Vectorless Mode)",
  group: "Hybrid Search Performance",
  async fn(benchContext) {
    benchContext.start();
    await ftsSearchIndex.search({ query: "unique keywords" });
    benchContext.end();
  },
});

Deno.bench({
  name: "Search: Hybrid RRF Fusion Search (Vector + FTS5)",
  group: "Hybrid Search Performance",
  async fn(benchContext) {
    benchContext.start();
    await hybridSearchIndex.search({ query: "unique keywords" });
    benchContext.end();
  },
});

Deno.bench({
  name: "Search: Graceful Degradation (Fallback to FTS5 on Error)",
  group: "Hybrid Search Performance",
  async fn(benchContext) {
    benchContext.start();
    await fallbackSearchIndex.search({ query: "unique keywords" });
    benchContext.end();
  },
});
