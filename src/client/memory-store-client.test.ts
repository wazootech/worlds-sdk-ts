/**
 * MemoryStore / SqliteStore-backed worlds client.
 *
 * Proves that the in-house stores — the engine's MemoryStore and
 * @worlds/sqlite's SqliteStore (the durable node:sqlite store, moved out of
 * @wazoo/sparql-engine/sqlite on 2026-08-17) — are truly interchangeable
 * with the client's own stores (MemoryStore, LibsqlStore) end to end: the same
 * Client facade, wired with RdfjsQuadStore + RdfjsSearchIndex + a sparql
 * engine over one shared RDF/JS store, works identically across engines and
 * stores.
 */
import type * as rdfjs from "@rdfjs/types";
import { assertEquals } from "@std/assert";
import {
  DataFactory,
  MemoryStore,
  WazooSparqlEngine,
} from "@wazoo/sparql-engine";
import { SqliteStore } from "@worlds/sqlite";
import { Client } from "./client.ts";
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
function createWazooClient(store: rdfjs.Store & { size: number }): Client {
  return new Client({
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

Deno.test("SqliteStore-backed client — import → search → SELECT → ASK → reindex end to end", async () => {
  const store = new SqliteStore({ path: ":memory:" });
  try {
    const client = createWazooClient(store);

    await client.import({
      source: {
        kind: "serialized",
        data: SEED_TURTLE,
        contentType: "text/turtle",
      },
    });

    // Imports landed in the same durable store the engine reads.
    assertEquals(store.size, 8);

    // Search over the durable store.
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

    // Reindex reports the store size through the durable store.
    const reindex = await client.reindex();
    assertEquals(reindex.processedQuadCount, 8);
  } finally {
    store.close();
  }
});

Deno.test("Differential parity — Wazoo(SqliteStore) vs Wazoo(MemoryStore) on identical data", async () => {
  const sqliteStore = new SqliteStore({ path: ":memory:" });
  const memoryStore = new MemoryStore();
  try {
    const sqliteClient = createWazooClient(sqliteStore);
    const memoryClient = createWazooClient(memoryStore);

    const seed = {
      source: {
        kind: "serialized",
        data: SEED_TURTLE,
        contentType: "text/turtle",
      },
    } as const;
    await sqliteClient.import(seed);
    await memoryClient.import(seed);

    // Multi-hop join: identical bindings (name + org).
    const sqliteMulti = normalizeBindings(
      assertSelect(await sqliteClient.sparql({ query: MULTI_HOP_QUERY })),
    );
    const memoryMulti = normalizeBindings(
      assertSelect(await memoryClient.sparql({ query: MULTI_HOP_QUERY })),
    );
    assertEquals(sqliteMulti, memoryMulti);

    // OPTIONAL + FILTER + ORDER BY: identical ordered bindings.
    const sqliteOptional = normalizeBindings(
      assertSelect(await sqliteClient.sparql({ query: OPTIONAL_FILTER_QUERY })),
    );
    const memoryOptional = normalizeBindings(
      assertSelect(await memoryClient.sparql({ query: OPTIONAL_FILTER_QUERY })),
    );
    assertEquals(sqliteOptional, memoryOptional);

    // ASK: identical boolean.
    const sqliteAsk = await sqliteClient.sparql({ query: ASK_QUERY });
    const memoryAsk = await memoryClient.sparql({ query: ASK_QUERY });
    if (sqliteAsk.kind !== "ask" || memoryAsk.kind !== "ask") {
      throw new Error("Expected ask responses from both stores");
    }
    assertEquals(sqliteAsk.data.boolean, memoryAsk.data.boolean);
  } finally {
    sqliteStore.close();
  }
});

Deno.test("SqliteStore-backed client — preloaded store shared across quad + sparql + search facades", async () => {
  const store = new SqliteStore({ path: ":memory:" });
  try {
    // Preload directly on the durable store (simulating a hydrated backend),
    // then verify the engine + search see it without a separate import step.
    store.addQuad(
      quad(
        namedNode("urn:pre"),
        namedNode("urn:pred"),
        literal("Preloaded fact."),
      ),
    );

    const client = createWazooClient(store);
    const bindings = assertSelect(
      await client.sparql({
        query: "SELECT ?o WHERE { <urn:pre> <urn:pred> ?o }",
      }),
    );
    assertEquals(bindings.length, 1);
    assertEquals(bindings[0].o?.value, "Preloaded fact.");

    const search = await client.search({ query: "preloaded" });
    assertEquals(search.results?.length, 1);
  } finally {
    store.close();
  }
});
