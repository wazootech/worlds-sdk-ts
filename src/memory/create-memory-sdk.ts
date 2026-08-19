import { Sdk } from "@/client/client.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@/rdfjs/mod.ts";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";

/**
 * createMemorySdk builds a portable in-memory Worlds Sdk backed by the Wazoo
 * engine's MemoryStore (the in-memory baseline, per the durable-backend map's
 * consolidation decision, wazootech/workspace#74).
 *
 * It is the shared parity reference and proving ground for the family: the
 * @worlds/sdk/testing harness (runParitySuite) and every backend's phase-4
 * parity suite can use it as a zero-dependency, in-memory reference — no
 * libsql checkout or private test double required. It wires the same Sdk
 * facade the durable backends expose (quad store + SPARQL + search over one
 * shared RDF/JS store), so a backend that matches it matches the family.
 *
 * The store is owned by the Sdk: each call returns an independent, fresh
 * topology. Use a factory (`() => createMemorySdk()`) where each case needs
 * an isolated world.
 */
export function createMemorySdk(): Sdk {
  const store = new MemoryStore();
  return new Sdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}
