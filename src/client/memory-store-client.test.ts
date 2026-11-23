import { expect, test } from "bun:test";
import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
import { WorldsSdk } from "./client.ts";
import type { SparqlBinding, SparqlResponse } from "./sparql-engine/mod.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "../rdfjs/mod.ts";

const { quad, namedNode, literal } = DataFactory;

const SEED_TURTLE = `
  <urn:alice> a <http://schema.org/Person> ; <http://schema.org/name> "Alice" ; <http://schema.org/knows> <urn:bob> .
  <urn:bob> a <http://schema.org/Person> ; <http://schema.org/name> "Bob" ; <http://schema.org/worksFor> <urn:acme> .
  <urn:acme> a <http://schema.org/Organization> ; <http://schema.org/name> "Acme Corp" .
`;

const MULTI_HOP_QUERY = "SELECT ?name ?org WHERE { " +
  '?a <http://schema.org/name> "Alice" ; <http://schema.org/knows> ?b . ' +
  "?b <http://schema.org/name> ?name ; <http://schema.org/worksFor> ?o . " +
  "?o <http://schema.org/name> ?org }";

const ASK_QUERY =
  "ASK WHERE { <urn:alice> <http://schema.org/knows> <urn:bob> }";

/* * Wires the full WorldsSdk facade over one shared RDF/JS store + WazooSparqlEngine. */
function createWazooClient(store: MemoryStore): WorldsSdk {
  return new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}

function assertSelect(response: SparqlResponse): SparqlBinding[] {
  if (response.kind !== "select") {
    throw new Error(`Expected select, got ${response.kind}`);
  }
  return response.data.results.bindings;
}

test("MemoryStore-backed client — import → search → SELECT → ASK → reindex end to end", async () => {
  const store = new MemoryStore();
  const client = createWazooClient(store);

  await client.import({
    source: {
      kind: "serialized",
      data: SEED_TURTLE,
      contentType: "text/turtle",
    },
  });

  // Imports landed in the same store the engine reads (3 + 3 + 2 triples).
  expect(store.size).toStrictEqual(8);

  // Search over the in-house store.
  const search = await client.search({ query: "acme" });
  expect(search.results?.length).toStrictEqual(1);
  expect(search.results?.[0].text).toStrictEqual("Acme Corp");

  // Multi-hop SELECT through WazooSparqlEngine.
  const multiHop = assertSelect(
    await client.sparql({ query: MULTI_HOP_QUERY }),
  );
  expect(multiHop.length).toStrictEqual(1);
  expect(multiHop[0].name?.value).toStrictEqual("Bob");
  expect(multiHop[0].org?.value).toStrictEqual("Acme Corp");

  // ASK.
  const ask = await client.sparql({ query: ASK_QUERY });
  if (ask.kind !== "ask") throw new Error(`Expected ask, got ${ask.kind}`);
  expect(ask.data.boolean).toStrictEqual(true);

  // Reindex reports the store size through the in-house store.
  const reindex = await client.reindex();
  expect(reindex.processedQuadCount).toStrictEqual(8);
});

test("MemoryStore-backed client — shared store instance across quad + sparql facades", async () => {
  const store = new MemoryStore();
  const client = createWazooClient(store);

  // Preload directly on the store (simulating a durable/hydrated backend),
  // then verify the engine + search see it without a separate import step.
  store.addQuad(
    quad(
      namedNode("urn:pre"),
      namedNode("urn:pred"),
      literal("Preloaded fact."),
    ),
  );

  const bindings = assertSelect(
    await client.sparql({
      query: "SELECT ?o WHERE { <urn:pre> <urn:pred> ?o }",
    }),
  );
  expect(bindings.length).toStrictEqual(1);
  expect(bindings[0].o?.value).toStrictEqual("Preloaded fact.");

  const search = await client.search({ query: "preloaded" });
  expect(search.results?.length).toStrictEqual(1);
});
