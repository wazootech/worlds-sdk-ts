/**
 * MemoryStore-backed worlds client.
 *
 * Proves that the engine's zero-dependency MemoryStore is interchangeable
 * with the client's own stores end to end on the in-memory topology: the same
 * WorldsSdk facade, wired with RdfjsQuadStore + RdfjsSearchIndex + a sparql
 * engine over one shared RDF/JS store, works identically across engines and
 * stores. Durable-store interchangeability is proven by each backend package
 * against @worlds/sdk/testing (see worlds-sqlite's client-integration and
 * parity suites).
 */
import type * as rdfjs from "@rdfjs/types";
import { assertEquals } from "@std/assert";
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
function createWazooClient(store: rdfjs.Store & { size: number }): WorldsSdk {
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

Deno.test("MemoryStore-backed client — import → search → SELECT → ASK → reindex end to end", async () => {
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
  assertEquals(store.size, 8);

  // Search over the in-house store.
  const search = await client.search({ query: "acme" });
  assertEquals(search.results?.length, 1);
  assertEquals(search.results?.[0].text, "Acme Corp");

  // Multi-hop SELECT through WazooSparqlEngine.
  const multiHop = assertSelect(
    await client.sparql({ query: MULTI_HOP_QUERY }),
  );
  assertEquals(multiHop.length, 1);
  assertEquals(multiHop[0].name?.value, "Bob");
  assertEquals(multiHop[0].org?.value, "Acme Corp");

  // ASK.
  const ask = await client.sparql({ query: ASK_QUERY });
  if (ask.kind !== "ask") throw new Error(`Expected ask, got ${ask.kind}`);
  assertEquals(ask.data.boolean, true);

  // Reindex reports the store size through the in-house store.
  const reindex = await client.reindex();
  assertEquals(reindex.processedQuadCount, 8);
});

Deno.test("MemoryStore-backed client — shared store instance across quad + sparql facades", async () => {
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
  assertEquals(bindings.length, 1);
  assertEquals(bindings[0].o?.value, "Preloaded fact.");

  const search = await client.search({ query: "preloaded" });
  assertEquals(search.results?.length, 1);
});
