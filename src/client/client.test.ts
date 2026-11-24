import { expect, test } from "bun:test";
import { DataFactory, Store } from "n3";
import { WorldsSdk } from "./client.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "../rdfjs/mod.ts";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { hashQuad, type Patch, Transaction } from "./quad-store/mod.ts";

const { quad, namedNode, literal } = DataFactory;

function createTestClient(store: Store): WorldsSdk {
  return new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({
      store: store,
      createTransaction: () => {
        return new Transaction({
          commit: (patch: Patch) => {
            for (const quad of patch.insertions) store.addQuad(quad);
            for (const quad of patch.deletions) store.removeQuad(quad);
            return Promise.resolve();
          },
        });
      },
    }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}

test("WorldsSdk.import delegates to quadStore.import", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    mode: "merge",
    source: {
      kind: "serialized",
      data: `<http://example.com/client> <http://example.com/action> "test_import" .`,
      contentType: "text/turtle",
    },
  });

  expect(store.size).toStrictEqual(1);
});

test("WorldsSdk.export delegates to quadStore.export", async () => {
  const store = new Store();
  const client = createTestClient(store);

  const response = await client.export({ format: { kind: "quads" } });

  if (response.kind !== "quads") throw new Error("Should be quads");
  expect(response.quads.length).toStrictEqual(0);
});

test("WorldsSdk.sparql delegates to sparqlEngine.execute", async () => {
  const store = new Store();
  const client = createTestClient(store);

  const response = await client.sparql({
    query: "ASK WHERE { ?s ?p ?o }",
  });

  if (response.kind !== "ask") throw new Error("Should be ask");
  expect(response.data.boolean).toStrictEqual(false);
});

test("WorldsSdk.sparql rejects when sparqlEngine is not configured", async () => {
  const store = new Store();
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });

  await expect(
    client.sparql({ query: "ASK WHERE { ?s ?p ?o }" }),
  ).rejects.toThrow("SPARQL engine is not configured.");
});

test("WorldsSdk.import rejects when quadStore is not configured", async () => {
  const client = new WorldsSdk({
    searchIndex: new RdfjsSearchIndex(new Store()),
  });

  await expect(
    (async () => {
      await client.import({
        mode: "merge",
        source: {
          kind: "serialized",
          data: `<http://example.com/s> <http://example.com/p> "x" .`,
          contentType: "text/turtle",
        },
      });
    })(),
  ).rejects.toThrow("Quad store is not configured.");
});

test("WorldsSdk.search rejects when searchIndex is not configured", async () => {
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store: new Store() }),
  });

  await expect(
    (async () => {
      await client.search({ query: "test" });
    })(),
  ).rejects.toThrow("Search index is not configured.");
});

test("WorldsSdk.search delegates to searchIndex.search", async () => {
  const store = new Store();
  store.addQuad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Integrate all systems."),
  );

  const client = createTestClient(store);

  const response = await client.search({ query: "integrate" });
  expect(response.results?.length).toStrictEqual(1);
  expect(response.results?.[0].text).toStrictEqual("Integrate all systems.");
});

test("WorldsSdk.search returns stable hashQuad-based search result ids", async () => {
  const store = new Store();
  const indexedQuad = quad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Integrate all systems."),
  );
  store.addQuad(indexedQuad);

  const client = createTestClient(store);

  const firstResponse = await client.search({ query: "integrate" });
  const secondResponse = await client.search({ query: "integrate" });
  const expectedId = hashQuad(indexedQuad);

  expect(firstResponse.results?.[0].id).toStrictEqual(expectedId);
  expect(secondResponse.results?.[0].id).toStrictEqual(expectedId);
});

test("WorldsSdk.reindex delegates to searchIndex.reindex", async () => {
  const store = new Store();
  store.addQuad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Reindex noop on RDF/JS."),
  );

  const client = createTestClient(store);
  const response = await client.reindex();

  expect(response.processedQuadCount).toStrictEqual(store.size);
  expect(response.chunkRowCount).toStrictEqual(0);
});

test("WorldsSdk - import delivers immediate search hits", async () => {
  const store = new Store();
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });

  const testQuad = quad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Factory wiring works."),
  );

  await client.import({
    source: { kind: "quads", quads: [testQuad] },
  });

  const response = await client.search({ query: "wiring" });
  expect(response.results?.length).toStrictEqual(1);
  expect(response.results?.[0].text).toStrictEqual("Factory wiring works.");
});

test("WorldsSdk - preloaded store is shared with the client", async () => {
  const store = new Store();
  store.addQuad(
    namedNode("http://example.com/existing"),
    namedNode("http://example.com/pred"),
    literal("Preloaded fact."),
  );

  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });

  const response = await client.search({ query: "preloaded" });
  expect(response.results?.length).toStrictEqual(1);
  expect(store.size).toStrictEqual(1);
});

test("WorldsSdk - queryEngine enables SELECT queries", async () => {
  const store = new Store();
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
    sparqlEngine: new WazooSparqlEngine({
      store: store,
      createTransaction: () => {
        return new Transaction({
          commit: (patch: Patch) => {
            for (const quad of patch.insertions) store.addQuad(quad);
            for (const quad of patch.deletions) store.removeQuad(quad);
            return Promise.resolve();
          },
        });
      },
    }),
  });

  await client.import({
    source: {
      kind: "quads",
      quads: [
        quad(
          namedNode("http://example.com/s"),
          namedNode("http://example.com/p"),
          literal("hello"),
        ),
      ],
    },
  });

  const response = await client.sparql({
    query:
      "SELECT ?text WHERE { <http://example.com/s> <http://example.com/p> ?text }",
  });

  if (response.kind !== "select") {
    throw new Error("Expected select response kind");
  }
  expect(response.data.results.bindings.length).toStrictEqual(1);
  expect(response.data.results.bindings[0].text?.value).toStrictEqual("hello");
});
