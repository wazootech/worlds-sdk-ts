import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { LibsqlSearchIndex } from "./libsql-search-index.ts";
import { FakeEmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import {
  setupLibsqlSchemaForTest,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

// --- Tests ---

Deno.test("LibsqlSearchIndex - Tracer Bullet: performs basic hybrid search and maps results", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const paddedVec = new Array(32).fill(0);
  paddedVec[0] = 1.0;
  const vecStr = JSON.stringify(paddedVec);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:alice",
      "urn:name",
      "urn:graph",
      "Alice is the explorer",
      "Alice is the explorer",
      vecStr,
    ],
  });

  const otherVec = [...paddedVec];
  otherVec[1] = 1.0;
  const otherVecStr = JSON.stringify(otherVec);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:bob",
      "urn:name",
      "urn:graph",
      "Bob stays back",
      "Bob stays back",
      otherVecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({ query: "Alice" });

  assertExists(response.results);
  const first = response.results[0];
  assertExists(first, "Expected at least one result.");
  assertEquals(first.subject, "urn:alice");
  assertEquals(first.predicate, "urn:name");
  assertEquals(first.text, "Alice is the explorer");
  assertEquals(typeof first.score, "number");
});

Deno.test("LibsqlSearchIndex - Scope Inclusion: limits matches only to included subjects", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const data = new Array(32).fill(0);
  data[0] = 1.0;
  const vecStr = JSON.stringify(data);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:person:1",
      "urn:bio",
      "urn:g1",
      "Loves coding and data",
      "Loves coding and data",
      vecStr,
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:person:2",
      "urn:bio",
      "urn:g1",
      "Loves coding and gardening",
      "Loves coding and gardening",
      vecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const base = await searchIndex.search({ query: "coding" });
  assertEquals(
    base.results?.length,
    2,
    "Baseline should find both coding references",
  );

  const filtered = await searchIndex.search({
    query: "coding",
    include: {
      subjects: ["urn:person:2"],
    },
  });

  assertEquals(
    filtered.results?.length,
    1,
    "Should return exactly one filtered match",
  );
  assertEquals(filtered.results?.[0].subject, "urn:person:2");
});

Deno.test("LibsqlSearchIndex - Scope Exclusion: suppresses explicitly excluded predicates", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const data = new Array(32).fill(0);
  data[0] = 1.0;
  const vecStr = JSON.stringify(data);

  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f1",
      "urn:e1",
      "urn:allowed",
      "urn:g",
      "Match text",
      "Match text",
      vecStr,
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
    args: [
      "f2",
      "urn:e1",
      "urn:forbidden",
      "urn:g",
      "Match text",
      "Match text",
      vecStr,
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({
    query: "Match",
    exclude: {
      predicates: ["urn:forbidden"],
    },
  });

  assertEquals(
    response.results?.length,
    1,
    "Only non-excluded predicate should remain",
  );
  assertEquals(response.results?.[0].predicate, "urn:allowed");
});

Deno.test("LibsqlSearchIndex - Vectorless Mode: gracefully degrades to keyword-only search when embeddingService is omitted", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  // Insert chunk rows with NULL vectors (Vectorless mode)
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-1",
      "urn:target",
      "urn:prop",
      "urn:g",
      "Specific search term inside target document",
      "Specific search term inside target document",
    ],
  });
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-2",
      "urn:other",
      "urn:prop",
      "urn:g",
      "Completely unrelated keywords",
      "Completely unrelated keywords",
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    client,
    // embeddingService is omitted intentionally to trigger Keyword-only FTS
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const response = await searchIndex.search({ query: "search term" });

  assertExists(response.results);
  assertEquals(
    response.results.length,
    1,
    "Should successfully locate exactly one record using raw FTS5",
  );
  assertEquals(response.results[0].subject, "urn:target");
  assertEquals(
    response.results[0].text,
    "Specific search term inside target document",
  );
});

Deno.test("LibsqlSearchIndex - Stability: executes search safely when query contains special FTS5 syntax characters without throwing crashes", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  // Insert a document we can try to find
  await client.execute({
    sql:
      `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      "id-1",
      "urn:subject",
      "urn:prop",
      "urn:g",
      'The magic phrase with "quotes"',
      'The magic phrase with "quotes"',
    ],
  });

  const searchIndex = new LibsqlSearchIndex({
    client,
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  // RED EXPECTATION: Running a query containing unclosed special characters (", {, etc.)
  // will crash SQLite during parsing unless sanitized.
  const dangerousQueries = [
    'magic "phrase"', // unclosed quotes within phrase
    '"hello', // starting lone quote
    "{ unclosed", // unclosed bracket
    "foo* bar", // asterisk suffix
  ];

  for (const query of dangerousQueries) {
    // This should NOT throw an error!
    const response = await searchIndex.search({ query });

    // Assert that it gracefully completes search without raising SQL exceptions
    assertExists(response.results, `Failed on query: ${query}`);
  }
});

/** FailingEmbeddingService always rejects embed() to exercise keyword fallback. */
class FailingEmbeddingService implements EmbeddingService {
  public embed(_texts: string[]): Promise<Array<Float32Array>> {
    return Promise.reject(new Error("embedding service unavailable"));
  }
}

/** WrongDimensionEmbeddingService returns vectors with an invalid width. */
class WrongDimensionEmbeddingService implements EmbeddingService {
  public embed(texts: string[]): Promise<Array<Float32Array>> {
    return Promise.resolve(texts.map(() => new Float32Array(8)));
  }
}

Deno.test(
  "LibsqlSearchIndex - degrades to keyword-only search when embeddingService throws",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        "id-fts",
        "urn:fallback",
        "urn:prop",
        "urn:g",
        "Unique fallback keyword phrase",
        "Unique fallback keyword phrase",
      ],
    });

    const searchIndex = new LibsqlSearchIndex({
      client,
      embeddingService: new FailingEmbeddingService(),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const response = await searchIndex.search({ query: "fallback keyword" });

    assertEquals(response.results?.length, 1);
    assertEquals(response.results?.[0].subject, "urn:fallback");
  },
);

Deno.test(
  "LibsqlSearchIndex - degrades when embedding dimensions do not match schema",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      args: [
        "id-dim",
        "urn:dim",
        "urn:prop",
        "urn:g",
        "Dimension mismatch keyword target",
        "Dimension mismatch keyword target",
      ],
    });

    const searchIndex = new LibsqlSearchIndex({
      client,
      embeddingService: new WrongDimensionEmbeddingService(),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const response = await searchIndex.search({
      query: "dimension mismatch",
    });

    assertEquals(response.results?.length, 1);
    assertEquals(response.results?.[0].subject, "urn:dim");
  },
);

Deno.test("LibsqlSearchIndex - respects custom result limit option", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const vecStr = JSON.stringify(new Array(32).fill(0));

  for (let index = 0; index < 5; index++) {
    await client.execute({
      sql:
        `INSERT INTO chunks (quad_id, subject, predicate, graph, value, fts_value, vector) VALUES (?, ?, ?, ?, ?, ?, vector32(?))`,
      args: [
        `id-${index}`,
        `urn:row:${index}`,
        "urn:prop",
        "urn:g",
        `Shared limit keyword row ${index}`,
        `Shared limit keyword row ${index}`,
        vecStr,
      ],
    });
  }

  const searchIndex = new LibsqlSearchIndex({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
    limit: 2,
  });

  const response = await searchIndex.search({ query: "limit keyword" });

  assertExists(response.results);
  assertEquals(
    response.results.length,
    2,
    "Custom limit should cap the number of returned rows",
  );
});
