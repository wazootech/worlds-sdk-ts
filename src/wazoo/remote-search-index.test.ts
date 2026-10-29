import { assertEquals, assertRejects } from "@std/assert";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteSearchIndex } from "./remote-search-index.ts";

// --- RemoteSearchIndex tests ---

Deno.test("RemoteSearchIndex.search delegates to searchWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/search": {
      results: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          graph: "http://example.com/g",
          content: "hello world",
          score: 0.95,
        },
      ],
    },
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await searchIndex.search({
    query: "hello",
    topK: 5,
    minScore: 0.5,
    include: {},
    exclude: {},
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/search");
  assertEquals(result.results?.length, 1);
  assertEquals(result.results?.[0].subject, "http://example.com/s");
  assertEquals(result.results?.[0].text, "hello world");
  assertEquals(result.results?.[0].score, 0.95);
  assertEquals(result.results?.[0].graph, "http://example.com/g");
});

Deno.test("RemoteSearchIndex.reindex delegates to reindexWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/reindex": { ok: true, status: "completed" },
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await searchIndex.reindex();

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/reindex");
  assertEquals(result.processedQuadCount, 0);
  assertEquals(result.chunkRowCount, 0);
});

Deno.test("RemoteSearchIndex.search throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/search": undefined,
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await assertRejects(
    () =>
      searchIndex.search({
        query: "test",
        include: {},
        exclude: {},
      }),
    Error,
    "Search failed",
  );
});
