# Architecture

This document describes the stable architecture of `@worlds/client` and how it
relates to the Worlds ecosystem.

## Package topology

`@worlds/client` ships the core client abstractions and the in-memory RDF/JS
backend. Durable backends are published as separate packages.

### In this package

| Export                                           | Role                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `@worlds/client`                                 | Root barrel: `Client`, interfaces, patch types, embedding-service, quad-chunker |
| `@worlds/client/quad-store`                      | Quad import/export API, RDF formats, patch transactions                         |
| `@worlds/client/search-index`                    | Search index interface and types                                                |
| `@worlds/client/sparql-engine`                   | SPARQL engine interface                                                         |
| `@worlds/client/rdfjs`                           | In-memory `RdfjsQuadStore` and `RdfjsSearchIndex` over `N3.Store`               |
| `@worlds/client/comunica`                        | `ComunicaSparqlEngine` adapter                                                  |
| `@worlds/client/ai-sdk`                          | Vercel AI SDK embedding service                                                 |
| `@worlds/client/tfjs-universal-sentence-encoder` | Offline TF.js USE embedding service                                             |

### External durable backends

| Package                                                        | Persistence          | Search               |
| -------------------------------------------------------------- | -------------------- | -------------------- |
| [`@worlds/libsql`](https://github.com/wazootech/worlds-libsql) | SQLite / Turso Cloud | Hybrid FTS5 + vector |
| [`@worlds/denokv`](https://github.com/wazootech/worlds-denokv) | Deno KV              | Keyword FTS          |

Durable backends implement the same quad store, search index, and SPARQL
interfaces. Each backend ships its own factory (`createLibsqlClient`,
`createDenokvClient`) that assembles a `Client` internally.

## Runtime model

### Dependency injection

`Client` (in `src/client/client.ts`) is a portable facade. All storage and query
behavior is provided through injected dependencies:

```typescript
interface ClientOptions {
  quadStore?: QuadStoreInterface;
  sparqlEngine?: SparqlEngineInterface;
  searchIndex?: SearchIndexInterface;
}
```

`Client` delegates each operation to the injected layer:

| Client method | Delegates to             |
| ------------- | ------------------------ |
| `import`      | `quadStore.import()`     |
| `export`      | `quadStore.export()`     |
| `sparql`      | `sparqlEngine.execute()` |
| `search`      | `searchIndex.search()`   |
| `reindex`     | `searchIndex.reindex()`  |

### In-memory topology (dev, tests, demos)

```typescript
import { Client } from "@worlds/client";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";

const store = new Store();
const client = new Client({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new ComunicaSparqlEngine({
    queryEngine: new QueryEngine(),
    store,
  }),
});
```

### Durable topologies

Durable backends wrap their own `*QuadStore`, `*SearchIndex`, and `*RdfjsStore`
implementations inside the factory:

```typescript
import { createLibsqlClient } from "@worlds/libsql";
// or
import { createDenokvClient } from "@worlds/denokv";
```

The factory returns the same `ClientInterface` contract. Application code never
needs to import the concrete store implementations directly unless doing custom
assembly.

## Query and retrieval model

The system uses a two-hop discovery pattern.

### Step 1: Search

Call `client.search()` with a keyword to discover subject IRIs. Search blends
keyword FTS5 and optional vector embeddings via Reciprocal Rank Fusion (RRF).
The `search-index-interface.ts` defines the contract; the in-memory
`RdfjsSearchIndex` provides a simple keyword filter over the N3 store. Durable
backends support hybrid (FTS5 + vector), keyword-only, and semantic-only modes.

### Step 2: SPARQL

Use the subject IRI from search results in a grounded SPARQL query to retrieve
exact graph facts. This is an exact, deterministic traversal, not a similarity
search.

```typescript
const searchResults = await client.search({ query: "explores" });
const subject = searchResults.results[0].subject;
const sparqlResponse = await client.sparql({
  query: `SELECT ?property ?object WHERE { <${subject}> ?property ?object }`,
});
```

### Why not one step?

- Search provides fuzzy/approximate retrieval but cannot express graph
  relationships (joins, filters, transitive closures).
- SPARQL provides precise graph traversal but cannot rank by semantic
  similarity.
- Combining them delivers both discovery and precision without depending on a
  single unreliable retrieval mode.

## Scale considerations

- In-memory RDF/JS is suitable for development, tests, and single-process demos
  with small graphs.
- For millions of quads and production workloads, use
  [`@worlds/libsql`](https://github.com/wazootech/worlds-libsql) (default) or
  [`@worlds/denokv`](https://github.com/wazootech/worlds-denokv).
- LibSQL is preferred for hybrid FTS/vector search and fast cold hexastore
  preload.
- Deno KV can be faster on selective SPARQL execute after preload in long-lived
  processes.
- Benchmark methodology and comparison tables live in the adapter repos and
  [discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69).

## Non-goals

- `@worlds/client` does not include a hosted Wazoo API client.
- Durable/immediate persistent backends (LibSQL, Deno KV) are not implemented
  inside this package. They ship in separate JSR packages with different
  lifecycle and dependency profiles.
- Provider-specific embedding implementations (e.g. OpenAI, Anthropic,
  Gemini-specific embedding code) should not be added to the core package unless
  they are intentionally exported abstractions.
- This package does not run performance benchmarks as part of CI. Benchmarks
  live in the adapter repos and are run locally.

## Agent integration

For AI agents consuming the `Client` API via tools:

1. Call `client.search()` with a keyword. Use the returned `subject` IRI (not
   `text` alone) as the binding for SPARQL.
2. Call `client.sparql()` for graph traversal. Start with a subject-bound query
   (`SELECT ?p ?o WHERE { <uri> ?p ?o }`).
3. Use exact literals from SPARQL bindings for final answers. Say "not found"
   instead of guessing.

See [AGENTS.md](AGENTS.md) for detailed agent coding rules and conventions.

## Related documents

- [AGENTS.md](AGENTS.md) — Imperative coding rules, naming conventions, CI
  guidance (read this before writing code).
- [README.md](README.md) — User-facing overview, quickstart, and examples.
