import { expect, test } from "bun:test";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteSearchIndex } from "./remote-search-index.ts";

// --- RemoteSearchIndex tests ---

test("RemoteSearchIndex.search delegates to searchWorld", async () => {
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

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual("/worlds/{id}/search");
  expect(result.results?.length).toStrictEqual(1);
  expect(result.results?.[0].subject).toStrictEqual("http://example.com/s");
  expect(result.results?.[0].text).toStrictEqual("hello world");
  expect(result.results?.[0].score).toStrictEqual(0.95);
  expect(result.results?.[0].graph).toStrictEqual("http://example.com/g");
});

test("RemoteSearchIndex.reindex delegates to reindexWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/reindex": { ok: true, status: "completed" },
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await searchIndex.reindex();

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual("/worlds/{id}/reindex");
  expect(result.processedQuadCount).toStrictEqual(0);
  expect(result.chunkRowCount).toStrictEqual(0);
});

test("RemoteSearchIndex.search throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/search": undefined,
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await expect(searchIndex.search({
        query: "test",
        include: {},
        exclude: {},
      })).rejects.toThrow("Search failed");
});
