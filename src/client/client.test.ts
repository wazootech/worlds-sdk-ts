import { assertEquals, assertRejects } from "@std/assert";
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

Deno.test("WorldsSdk.import delegates to quadStore.import", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    mode: "merge",
    source: {
      kind: "serialized",
      data:
        `<http://example.com/client> <http://example.com/action> "test_import" .`,
      contentType: "text/turtle",
    },
  });

  assertEquals(
    store.size,
    1,
    "WorldsSdk should have successfully invoked quadStore import",
  );
});

Deno.test("WorldsSdk.export delegates to quadStore.export", async () => {
  const store = new Store();
  const client = createTestClient(store);

  const response = await client.export({ format: { kind: "quads" } });

  if (response.kind !== "quads") throw new Error("Should be quads");
  assertEquals(response.quads.length, 0);
});

Deno.test("WorldsSdk.sparql delegates to sparqlEngine.execute", async () => {
  const store = new Store();
  const client = createTestClient(store);

  const response = await client.sparql({
    query: "ASK WHERE { ?s ?p ?o }",
  });

  if (response.kind !== "ask") throw new Error("Should be ask");
  assertEquals(response.data.boolean, false);
});

Deno.test("WorldsSdk.sparql rejects when sparqlEngine is not configured", async () => {
  const store = new Store();
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });

  await assertRejects(
    () => client.sparql({ query: "ASK WHERE { ?s ?p ?o }" }),
    Error,
    "SPARQL engine is not configured.",
  );
});

Deno.test("WorldsSdk.import rejects when quadStore is not configured", async () => {
  const client = new WorldsSdk({
    searchIndex: new RdfjsSearchIndex(new Store()),
  });

  await assertRejects(
    async () => {
      await client.import({
        mode: "merge",
        source: {
          kind: "serialized",
          data: `<http://example.com/s> <http://example.com/p> "x" .`,
          contentType: "text/turtle",
        },
      });
    },
    Error,
    "Quad store is not configured.",
  );
});

Deno.test("WorldsSdk.search rejects when searchIndex is not configured", async () => {
  const client = new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store: new Store() }),
  });

  await assertRejects(
    async () => {
      await client.search({ query: "test" });
    },
    Error,
    "Search index is not configured.",
  );
});

Deno.test("WorldsSdk.search delegates to searchIndex.search", async () => {
  const store = new Store();
  store.addQuad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Integrate all systems."),
  );

  const client = createTestClient(store);

  const response = await client.search({ query: "integrate" });
  assertEquals(response.results?.length, 1);
  assertEquals(response.results?.[0].text, "Integrate all systems.");
});

Deno.test("WorldsSdk.search returns stable hashQuad-based search result ids", async () => {
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

  assertEquals(firstResponse.results?.[0].id, expectedId);
  assertEquals(secondResponse.results?.[0].id, expectedId);
});

Deno.test("WorldsSdk.reindex delegates to searchIndex.reindex", async () => {
  const store = new Store();
  store.addQuad(
    namedNode("http://example.com/sub"),
    namedNode("http://example.com/pred"),
    literal("Reindex noop on RDF/JS."),
  );

  const client = createTestClient(store);
  const response = await client.reindex();

  assertEquals(response.processedQuadCount, store.size);
  assertEquals(response.chunkRowCount, 0);
});

Deno.test("WorldsSdk - import delivers immediate search hits", async () => {
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
  assertEquals(response.results?.length, 1);
  assertEquals(response.results?.[0].text, "Factory wiring works.");
});

Deno.test("WorldsSdk - preloaded store is shared with the client", async () => {
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
  assertEquals(response.results?.length, 1);
  assertEquals(store.size, 1);
});

Deno.test("WorldsSdk - queryEngine enables SELECT queries", async () => {
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
  assertEquals(response.data.results.bindings.length, 1);
  assertEquals(response.data.results.bindings[0].text?.value, "hello");
});
