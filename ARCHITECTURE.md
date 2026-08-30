# Architecture

This document describes the stable architecture of `@worlds/sdk` and how it
relates to the Worlds ecosystem.

## Package topology

`@worlds/sdk` ships the core client abstractions and the in-memory RDF/JS
backend. Durable backends are published as separate packages.

### In this package

| Export                      | Role                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `@worlds/sdk`               | Root barrel: `WorldsSdk`, interfaces, patch types, embedding-service, quad-chunker |
| `@worlds/sdk/quad-store`    | Quad import/export API, RDF formats, patch transactions                            |
| `@worlds/sdk/search-index`  | Search index interface and types                                                   |
| `@worlds/sdk/sparql-engine` | SPARQL engine interface                                                            |
| `@worlds/sdk/rdfjs`         | In-memory `RdfjsQuadStore` and `RdfjsSearchIndex` over the engine's `MemoryStore`  |
| `@worlds/sdk/ai-sdk`        | Vercel AI SDK embedding service                                                    |

### External durable backends

| Package                                                                                                            | Persistence                | Search                      | Status                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@worlds/libsql`](https://jsr.io/@worlds/libsql) ([repo](https://github.com/wazootech/worlds-libsql))             | SQLite / Turso Cloud       | Hybrid FTS5 + vector        | **Available** — full SDK factory (`createLibsqlWorldsSdk`); consumes `@worlds/sqlite/sql-core`                                                  |
| [`@worlds/sqlite`](https://jsr.io/@worlds/sqlite) ([repo](https://github.com/wazootech/worlds-sqlite))             | Local file (`node:sqlite`) | Hybrid FTS5 + sqlite-vec    | **Available** — full SDK factory (`createSqliteWorldsSdk`); canonical SQLite-family source of truth via its driver-free `./sql-core` plan layer |
| [`@worlds/postgres`](https://jsr.io/@worlds/postgres) ([repo](https://github.com/wazootech/worlds-postgres))       | PostgreSQL + pgvector      | Hybrid tsvector + pgvector  | **Available** — full SDK factory (`createPostgresWorldsSdk`); PostgreSQL-native search, deliberately not a `sql-core` consumer                  |
| [`@worlds/cloudflare`](https://jsr.io/@worlds/cloudflare) ([repo](https://github.com/wazootech/worlds-cloudflare)) | D1 (miniflare-tested)      | FTS5 keyword via `sql-core` | **Available** — full SDK factory (`createCloudflareWorldsSdk`); consumes `@worlds/sqlite/sql-core`; Vectorize planned                           |
| [`@worlds/indexeddb`](https://jsr.io/@worlds/indexeddb) ([repo](https://github.com/wazootech/worlds-indexeddb))    | Browser IndexedDB          | JS hybrid TF-IDF + cosine   | **Available** — full SDK factory (`createIndexeddbWorldsSdk`)                                                                                   |

The Deno KV backend (`@worlds/denokv`) is
[archived](https://github.com/wazootech/worlds-denokv); `@worlds/libsql` (Turso)
is the supported cloud durable backend. Backend maturity: every durable backend
ships a full SDK factory through the standard `create*WorldsSdk` assembly.
`@worlds/sqlite` is additionally the **source of truth for SQLite-family SQL
logic** — it is the easiest backend to test locally (synchronous `node:sqlite`)
and publishes the shared, driver-free `./sql-core` plan layer that both
`@worlds/libsql` and `@worlds/cloudflare` consume for FTS sanitization, chunk
DDL, keyword branch plans, and search-result identity. Quad storage layout and
each vector-search dialect intentionally stay backend-local: `@worlds/postgres`
implements PostgreSQL-native search (generated `tsvector`, pgvector cosine, RRF
fusion) and deliberately does not consume `sql-core`; `@worlds/indexeddb` runs
entirely in-browser. Per the
[de-escalated durable-backend seam decision](#durable-backend-seam-removed-from-worldssdk-de-escalated)
below, the provider-strategy vocabulary stays backend-internal.

Durable backends implement the same quad store, search index, and SPARQL
interfaces. The LibSQL backend ships its own factory (`createLibsqlWorldsSdk`)
that assembles a `WorldsSdk` internally.

## Runtime model

### Dependency injection

`WorldsSdk` (in `src/client/client.ts`) is a portable facade. All storage and
query behavior is provided through injected dependencies:

```typescript
interface WorldsSdkOptions {
  quadStore?: QuadStoreInterface;
  sparqlEngine?: SparqlEngineInterface;
  searchIndex?: SearchIndexInterface;
}
```

`WorldsSdk` delegates each operation to the injected layer:

| WorldsSdk method | Delegates to             |
| ---------------- | ------------------------ |
| `import`         | `quadStore.import()`     |
| `export`         | `quadStore.export()`     |
| `sparql`         | `sparqlEngine.execute()` |
| `search`         | `searchIndex.search()`   |
| `reindex`        | `searchIndex.reindex()`  |

**Graph-agnostic guarantee (workspace#71, #179):** A world's quads may span the
default graph and any number of named graphs (unbounded). No backend or SDK code
constrains a world to a single graph — search scopes by graph via
`QuadFilter.graphs`, SPARQL queries across graphs, and import/export preserves
all graph membership.

### In-memory topology (dev, tests, demos)

```typescript
import { WorldsSdk } from "@worlds/sdk";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";

const store = new MemoryStore();
const client = new WorldsSdk({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new WazooSparqlEngine({ store }),
});
```

### Durable topologies

Durable backends wrap their own `*QuadStore`, `*SearchIndex`, and `*RdfjsStore`
implementations inside the factory:

```typescript
import { createLibsqlWorldsSdk } from "@worlds/libsql";
```

The factory returns the same `WorldsSdkInterface` contract. Application code
never needs to import the concrete store implementations directly unless doing
custom assembly.

## Query and retrieval model

The system uses a two-hop discovery pattern.

### Step 1: Search

Call `client.search()` with a keyword to discover subject IRIs. Search blends
keyword FTS5 and optional vector embeddings via Reciprocal Rank Fusion (RRF).
The `search-index-interface.ts` defines the contract; the in-memory
`RdfjsSearchIndex` provides a simple keyword filter over the in-memory store.
Durable backends support hybrid (FTS5 + vector), keyword-only, and semantic-only
modes.

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
  1.2 engine that implements `SparqlEngineInterface`, drops into a `WorldsSdk`
  unchanged, and runs over any `rdfjs.Store` (the engine's `MemoryStore` here;
  `LibsqlRdfjsStore` in the LibSQL backend). It covers SELECT / ASK / CONSTRUCT
  / DESCRIBE plus UPDATE, enforces `timeoutMs`, and accepts a request-level
  `baseIri`.

A custom engine remains feasible through `SparqlEngineInterface`.

See
[Wazoopedia decision record](https://github.com/wazootech/wazoopedia/blob/main/wiki/Decision_Sparql_Engine_Rdfjs_Lite.md)
for the original SPARQL engine rationale.

## Scale considerations

## Decision records

Decisions that shape the package's architecture and must not be re-litigated in
review live here, indexed by the wayfinder map
([workspace#8](https://github.com/wazootech/workspace/issues/8)).

### Durable-backend seam: removed from `@worlds/sdk` (de-escalated)

**Date:** 2026-08-18 · **Status:** Accepted · **Canonical tickets:**
[worlds-sdk-ts#170](https://github.com/wazootech/worlds-sdk-ts/issues/170)
(reopened),
[worlds-sdk-ts#172](https://github.com/wazootech/worlds-sdk-ts/issues/172)

`@worlds/sdk/durable-backend` shipped the provider-seam strategy interfaces
(`ConnectionDriver`, `SchemaBuilder`, `SearchQueryBuilder`) as the **documented
shape of a durable backend**, types-only. Review (2026-08-18) concluded the seam
is premature public abstraction (YAGNI):

- **Zero published consumers.** The only JSR dependent of `@worlds/sdk` is
  `@worlds/libsql`, and it does not import the subpath. The seam's only planned
  consumer was the in-flight worlds-libsql#17.
- **No evidence-backed future adoption.** The parked backends (`@worlds/sqlite`,
  `@worlds/postgres`) are built and shipping on raw provider clients; conforming
  later would be a rewrite. `@worlds/denokv` is archived.
- **The sdk ships zero SQL.** A published vocabulary contract with one consumer
  is premature public abstraction.

The three concrete strategy classes live on as **private worlds-libsql
vocabulary** (`LibsqlConnectionDriver`, `LibsqlSchemaBuilder`,
`LibsqlSearchQueryBuilder`) — backend-internal, not a published sdk contract.
Cross-backend composition remains at the `WorldsSdk` seam (`QuadStoreInterface`
/ `SearchIndexInterface` / `SparqlEngineInterface`). Do not re-add a
provider-seam subpath to `@worlds/sdk` in review. Supersedes the seam decisions
recorded in
[worlds-sdk-ts#168](https://github.com/wazootech/worlds-sdk-ts/issues/168) and
[worlds-sdk-ts#170](https://github.com/wazootech/worlds-sdk-ts/issues/170).

## Non-goals

- The hosted Worlds API client (`@worlds/sdk/wazoo`) is available via
  `createWazooSdk`, backed by `@worlds/client` (peer dependency).
- Durable/immediate persistent backends (LibSQL) are not implemented inside this
  package. They ship in separate JSR packages with different lifecycle and
  dependency profiles.
- Provider-specific embedding implementations (e.g. OpenAI, Anthropic,
  Gemini-specific embedding code) should not be added to the core package unless
  they are intentionally exported abstractions.
- This package does not run performance benchmarks as part of CI. Benchmarks
  live in the adapter repos and are run locally.

## Agent integration

For AI agents consuming the `WorldsSdk` API via tools:

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
