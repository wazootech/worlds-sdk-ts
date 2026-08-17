# Architecture

This document describes the stable architecture of `@worlds/sdk` and how it
relates to the Worlds ecosystem.

## Package topology

`@worlds/sdk` ships the core client abstractions and the in-memory RDF/JS
backend. Durable backends are published as separate packages.

### In this package

| Export                                        | Role                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `@worlds/sdk`                                 | Root barrel: `Client`, interfaces, patch types, embedding-service, quad-chunker |
| `@worlds/sdk/quad-store`                      | Quad import/export API, RDF formats, patch transactions                         |
| `@worlds/sdk/search-index`                    | Search index interface and types                                                |
| `@worlds/sdk/sparql-engine`                   | SPARQL engine interface                                                         |
| `@worlds/sdk/rdfjs`                           | In-memory `RdfjsQuadStore` and `RdfjsSearchIndex` over `N3.Store`               |
| `@worlds/sdk/ai-sdk`                          | Vercel AI SDK embedding service                                                 |
| `@worlds/sdk/tfjs-universal-sentence-encoder` | Offline TF.js USE embedding service                                             |

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
import { Client } from "@worlds/sdk";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";
import { Store } from "n3";

const store = new Store();
const client = new Client({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new WazooSparqlEngine({ store }),
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

## SPARQL engine choice

`@worlds/sdk` is engine-agnostic: the `SparqlEngineInterface` abstraction
(`execute(request)`) makes any engine swappable without changing client code.
The single engine shipped today is:

- **Wazoo** — [`@wazoo/sparql-engine`](https://jsr.io/@wazoo/sparql-engine) is
  the opinionated minimal default. It is a zero-runtime-dependency SPARQL 1.1 &
  1.2 engine that implements `SparqlEngineInterface`, drops into a `Client`
  unchanged, and runs over any `rdfjs.Store` (N3 here; `LibsqlRdfjsStore` /
  `DenokvRdfjsStore` in the durable backends). It covers SELECT / ASK /
  CONSTRUCT / DESCRIBE plus UPDATE, enforces `timeoutMs`, and accepts a
  request-level `baseIri`.

A custom engine remains feasible through `SparqlEngineInterface`.

See
[Wazoopedia decision record](https://github.com/wazootech/wazoopedia/blob/main/wiki/Decision_Sparql_Engine_Rdfjs_Lite.md)
for the original SPARQL engine rationale.

## Scale considerations

## Non-goals

- `@worlds/sdk` does not include a hosted Wazoo API client.
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
