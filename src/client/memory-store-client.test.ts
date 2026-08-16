/**
 * MemoryStore / SqliteStore-backed worlds client.
 *
 * Proves that the in-house @wazoo/sparql-engine stores (MemoryStore,
 * SqliteStore) are truly interchangeable with the client's own stores
 * (N3.Store, LibsqlStore) end to end: the same Client facade, wired with
 * RdfjsQuadStore + RdfjsSearchIndex + a sparql engine over one shared
 * RDF/JS store, works identically whether the engine is the in-house
 * WazooSparqlEngine or Comunica's adapter — and returns identical results
 * on identical data (differential parity).
 */
import { assertEquals } from "@std/assert";
import { DataFactory as N3, Store as N3Store } from "n3";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
// Note: SqliteStore ships behind the ./sqlite subpath, which the published
// @wazoo/sparql-engine@0.2.0 does not export yet (source has it). It is
// exercised by the engine repo's own sqlite-store + parity suites; once the
// subpath is published, add a SqliteStore({ path: ":memory:" }) case here.
import { Client } from "./client.ts";
import type { SparqlBinding, SparqlResponse } from "./sparql-engine/mod.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "../rdfjs/mod.ts";
import { ComunicaSparqlEngine } from "../comunica/mod.ts";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { type Patch, Transaction } from "./quad-store/mod.ts";

const { quad, namedNode, literal } = N3;

const SEED_TURTLE = `
  <urn:alice> a <http://schema.org/Person> ; <http://schema.org/name> "Alice" ; <http://schema.org/knows> <urn:bob> .
  <urn:bob> a <http://schema.org/Person> ; <http://schema.org/name> "Bob" ; <http://schema.org/worksFor> <urn:acme> .
  <urn:acme> a <http://schema.org/Organization> ; <http://schema.org/name> "Acme Corp" .
`;

const MULTI_HOP_QUERY = "SELECT ?name ?org WHERE { " +
  '?a <http://schema.org/name> "Alice" ; <http://schema.org/knows> ?b . ' +
  "?b <http://schema.org/name> ?name ; <http://schema.org/worksFor> ?o . " +
  "?o <http://schema.org/name> ?org }";

const OPTIONAL_FILTER_QUERY = "SELECT ?name ?org WHERE { " +
  "?p a <http://schema.org/Person> ; <http://schema.org/name> ?name . " +
  "OPTIONAL { ?p <http://schema.org/worksFor> ?o . ?o <http://schema.org/name> ?org } . " +
  'FILTER(CONTAINS(LCASE(?name), "a")) } ORDER BY ?name';

const ASK_QUERY =
  "ASK WHERE { <urn:alice> <http://schema.org/knows> <urn:bob> }";

/** Normalizes bindings to the observable SPARQL term contract (type + value). */
function normalizeBindings(bindings: SparqlBinding[]): unknown {
  return bindings.map((b) =>
    Object.fromEntries(
      Object.entries(b).map((
        [key, value],
      ) => [key, { type: value.type, value: value.value }]),
    )
  );
}

/** Wires the full Client facade over one shared RDF/JS store + WazooSparqlEngine. */
function createWazooClient(store: MemoryStore): Client {
  return new Client({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}

/** The same facade over N3.Store + Comunica (the pre-swap configuration). */
function createComunicaClient(store: N3Store): Client {
  return new Client({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new ComunicaSparqlEngine({
      queryEngine: new QueryEngine(),
      store: store,
      createTransaction: () =>
        new Transaction({
          commit: (patch: Patch) => {
            for (const inserted of patch.insertions) store.addQuad(inserted);
            for (const deleted of patch.deletions) store.removeQuad(deleted);
            return Promise.resolve();
          },
        }),
    }),
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

Deno.test("Differential parity — Wazoo(MemoryStore) vs Comunica(N3) on identical data", async () => {
  const memoryStore = new MemoryStore();
  const wazooClient = createWazooClient(memoryStore);

  const n3Store = new N3Store();
  const comunicaClient = createComunicaClient(n3Store);

  const seed = {
    source: {
      kind: "serialized",
      data: SEED_TURTLE,
      contentType: "text/turtle",
    },
  } as const;
  await wazooClient.import(seed);
  await comunicaClient.import(seed);

  // Multi-hop join: identical bindings (name + org).
  const wazooMulti = normalizeBindings(
    assertSelect(await wazooClient.sparql({ query: MULTI_HOP_QUERY })),
  );
  const comunicaMulti = normalizeBindings(
    assertSelect(await comunicaClient.sparql({ query: MULTI_HOP_QUERY })),
  );
  assertEquals(wazooMulti, comunicaMulti);

  // OPTIONAL + FILTER + ORDER BY: identical ordered bindings.
  const wazooOptional = normalizeBindings(
    assertSelect(await wazooClient.sparql({ query: OPTIONAL_FILTER_QUERY })),
  );
  const comunicaOptional = normalizeBindings(
    assertSelect(await comunicaClient.sparql({ query: OPTIONAL_FILTER_QUERY })),
  );
  assertEquals(wazooOptional, comunicaOptional);

  // ASK: identical boolean.
  const wazooAsk = await wazooClient.sparql({ query: ASK_QUERY });
  const comunicaAsk = await comunicaClient.sparql({ query: ASK_QUERY });
  if (wazooAsk.kind !== "ask" || comunicaAsk.kind !== "ask") {
    throw new Error("Expected ask responses from both engines");
  }
  assertEquals(wazooAsk.data.boolean, comunicaAsk.data.boolean);
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
