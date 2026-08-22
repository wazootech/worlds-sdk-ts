import { WorldsSdk } from "@/client/client.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@/rdfjs/mod.ts";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";

/**
 * createMemoryWorldsSdk builds a portable in-memory WorldsSdk backed by the Wazoo
 * engine's MemoryStore (the in-memory baseline, per the durable-backend map's
 * consolidation decision, wazootech/workspace#74).
 *
 * It is the shared parity reference and proving ground for the family: the
 * @worlds/sdk/testing harness (runParitySuite) and every backend's phase-4
 * parity suite can use it as a zero-dependency, in-memory reference — no
 * libsql checkout or private test double required. It wires the same WorldsSdk
 * facade the durable backends expose (quad store + SPARQL + search over one
 * shared RDF/JS store), so a backend that matches it matches the family.
 *
 * The store is owned by the WorldsSdk: each call returns an independent, fresh
 * topology. Use a factory (`() => createMemoryWorldsSdk()`) where each case needs
 * an isolated world.
 */
export function createMemoryWorldsSdk(): WorldsSdk {
  const store = new MemoryStore();
  return new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}
