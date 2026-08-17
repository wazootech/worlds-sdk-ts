# Provider seam: durable backends

Status: design proposal. This documents the consensus reached when deciding
whether `@worlds/libsql` and a future SQLite backend should be merged.

## Decision: support both, they are not rivals

`@worlds/libsql` and `@worlds/sqlite` are **two points in a capability matrix**,
not two implementations of the same thing. Neither replaces the other.

| Capability               | `@worlds/libsql` (Turso)                                               | `@worlds/sqlite` (`node:sqlite`)                                          |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Connection               | `@libsql/client` — HTTP/WebSocket remote + embedded                    | `DatabaseSync` — local file / `:memory:` only                             |
| Durability / scale       | Turso Cloud, per-world databases                                       | single local file, single process                                         |
| Keyword search           | FTS5                                                                   | keyword scan (JS substring or SQL `LIKE`)                                 |
| Vector / semantic search | LibSQL vector module (`F32_BLOB`, `libsql_vector_idx`, `vector_top_k`) | none by default; `sqlite-vec` via `loadExtension` is the optional upgrade |
| RRF hybrid fusion        | SQL-side (`vector_top_k` + FTS rank)                                   | JS-side over keyword + vector candidates (see hybrid avenue below)        |
| RDF/JS quad store        | columnar quads + 7 covering indexes + keyset paging                    | term-keyed quads + JSON payload, synchronous                              |

The original "drop `LibsqlStore` in favor of `SqliteStore`" idea is rejected:
the LibSQL vector module and FTS5 are load-bearing for the production data plane
and do not exist in `node:sqlite`. The reverse (SQLite only) is equally wrong:
it cannot reach Turso or run LibSQL-vector RRF.

## Why the two cannot share their SQL

Two facts make "use the same code in both across the board" a non-goal:

1. **Vector search is bound to a LibSQL-only extension.** The schema uses
   `vector F32_BLOB(n)`, `libsql_vector_idx(vector, 'metric=cosine')`, and the
   query uses `vector_top_k(...)` + `vector32(...)`. None of these exist in
   stock SQLite or `node:sqlite`.
2. **FTS5 is not compiled into Node's `node:sqlite`.** Node builds its bundled
   SQLite without `SQLITE_ENABLE_FTS5` (the `--sqlite-enable-fts5` configure
   flag exists only since Node 23.x). Deno's `node:sqlite` exposes
   `loadExtension`, so `sqlite-vec` is available there as a _different_
   extension with a _different_ API than LibSQL's vector module.

Any "shared search SQL" layer would be a lie at the vector layer. The seam below
shares everything that is genuinely portable and isolates everything that is
not.

## Worlds is not an RDF/JS store

A second distinction that shapes the seam: the Worlds search index has
requirements a plain `rdfjs.Store` does not have.

- `rdfjs.Store` (`SqliteStore`, N3 `Store`) provides `match` / `countQuads` /
  `addQuad` / `removeQuad` / `removeMatches`. It has no notion of search.
- The Worlds durable backend adds **chunk projection** (`quad → text chunk`),
  **subject alias discovery** via `labelPredicates`, **include/exclude
  `QuadFilter`** boundaries, **reindex-from-quads**, and **RRF fusion**.

Concretely, `SqliteStore` in `@wazoo/sparql-engine` is a _quad primitive_ that a
SQLite backend would _consume_, not the search engine itself. The search layer
composes on top of the quad store and is a separate strategy object.

## The seam: four strategy objects

A durable backend is assembled from four strategy objects. Each is a TypeScript
interface owned by `@worlds/sdk`; each backend supplies its own concrete
implementation and a factory (`createLibsqlClient`, `createSqliteClient`) that
wires them into a `Client`.

```typescript
interface DurableBackendParts {
  connection: ConnectionDriver;
  schema: SchemaBuilder;
  quadStore: QuadStoreBackend;
  searchQuery: SearchQueryBuilder;
}
```

### 1. `ConnectionDriver`

Wraps the transport so the other three never see it.

- LibSQL: `@libsql/client` `Client` (remote + embedded, async, batched,
  keyset-paged reads).
- SQLite: `node:sqlite` `DatabaseSync` (synchronous local connection; async
  adaptation is a thin `Promise.resolve` wrapper).

Responsible for: executing SQL, transactions, paging, batching, and connection
lifecycle. This is where the remote-vs-local split lives and stays.

### 2. `SchemaBuilder`

Produces DDL strings and migration steps. Owns the _storage_ dialect.

- LibSQL: columnar `quads` + 7 covering indexes, `chunks` with
  `vector F32_BLOB(n)`, `chunks_fts` FTS5 external-content virtual table,
  `idx_chunks_vector` via `libsql_vector_idx`, and the `chunks_ai`/`chunks_ad`
  triggers.
- SQLite: `quads` (term-keyed or columnar), a keyword `chunks` table if the
  backend opts into materialized search, and — only when `sqlite-vec` is loaded
  — a `vec0` table. No FTS5 DDL.

The schema builders deliberately do **not** share code; they share only the
shape of the tables they expose to `QuadStoreBackend` and `SearchQueryBuilder`.

### 3. `QuadStoreBackend`

Implements `QuadStoreInterface` (import/export/transaction) on top of the
driver + schema, and drives chunk projection on commit.

- LibSQL: `LibsqlRdfjsStore` (read source) + `LibsqlQuadStore`
  (import/export/transaction + `LibsqlSearchIndexProjector`).
- SQLite: `SqliteStore` (from `@wazoo/sparql-engine/sqlite`) as the read/write
  primitive, plus a thin transaction adapter.

### 4. `SearchQueryBuilder`

Implements `SearchIndexInterface.search`/`reindex` by building backend SQL.

- LibSQL: `LibsqlSearchQueryBuilder` — FTS5 + `vector_top_k` RRF, dimension
  guardrails, `sanitizeFtsQuery`.
- SQLite: signal-source adapter — keyword candidates via `LIKE` scan or a JS
  inverted index, vector candidates via `sqlite-vec` `vec0` or a JS cosine scan.
  Fusion happens in the shared Worlds layer, not in the adapter. `sqlite-vec` is
  one of two vector paths (the other is zero-extension JS cosine), both behind
  the same `EmbeddingService` seam.

## Avenue: full hybrid RRF on SQLite storage

SQLite is **not** capped at keyword-only. Full hybrid RRF is reachable on
`node:sqlite`; it just decomposes differently than it does on LibSQL.

RRF fusion itself is storage-agnostic arithmetic: two ranked candidate lists in,
one fused score out (`1/(60 + rank)` per signal, summed). LibSQL happens to do
that arithmetic in SQL because both signals already live in the database. SQLite
cannot, so the fusion moves into the shared Worlds layer — which is the portable
home anyway. What changes per backend is only **signal retrieval**:

| Signal  | LibSQL (`@worlds/libsql`)         | SQLite (`@worlds/sqlite`)                                         |
| ------- | --------------------------------- | ----------------------------------------------------------------- |
| Keyword | FTS5 `MATCH` (in SQL)             | `LIKE` scan, or a JS-side inverted index over `chunks`            |
| Vector  | `vector_top_k` (in SQL)           | `sqlite-vec` `vec0` via `loadExtension`, or a JS-side cosine scan |
| Fusion  | `COALESCE(1/(60+rank), 0)` in SQL | shared JS RRF over the two candidate lists                        |

This reframes `SearchQueryBuilder` as a **signal-source adapter** rather than a
whole-search implementation. It returns ranked candidates for keyword and/or
vector signals; the shared Worlds layer does chunking, embedding, subject alias
discovery, and RRF fusion identically on both backends.

The worlds layer therefore **extends the `SqliteStore` core** exactly as the
user intended: `SqliteStore` remains the pure quad primitive (no search), and
the Worlds search layer sits above it, materializing `chunks` and retrieving
signals through the adapter. The avenue has three stages, each a drop-in upgrade
of the SQLite signal adapter:

1. **Keyword-only** — `LIKE` scan or JS inverted index; no vector signal.
   `createSqliteClient` v1.
2. **Hybrid (extension-assisted)** — load `sqlite-vec`, keep `vec0` vectors in
   the `chunks` table, retrieve `vec0` top-K plus keyword candidates, fuse in
   JS. Fully hybrid RRF, one loadable extension, no LibSQL required.
3. **Hybrid (zero-extension)** — JS-side cosine over in-memory vectors for small
   worlds; same fusion path, no native code. Degrades gracefully to stage 1 as
   vector count grows.

Because stages 1–3 differ only in the SQLite `SearchQueryBuilder`, the Worlds
layer, `QuadStoreBackend`, and `createSqliteClient` assembly are written once.
This is the concrete answer to "can SQLite do the same hybrid search as LibSQL":
yes, with a swapped vector backend, and the seam makes that swap a strategy
change rather than a fork.

## What is shared (lives in `@worlds/sdk`)

The storage-agnostic orchestration is shared by both backends and already mostly
lives in `@worlds/sdk`:

- `QuadStoreInterface` / `SearchIndexInterface` / `SparqlEngineInterface`
- `chunk-quads` (quad → text chunk projection)
- `search-chunk-fts` (FTS-value builder)
- `build-search-result-id` (deterministic result identity)
- `sanitizeFtsQuery` (portable; LibSQL keeps its stopword list as data)
- the RRF rank arithmetic `1/(60 + rank)`
- `EmbeddingService` / `TextSplitterInterface` contracts

The four strategy interfaces above are the new addition: they are the _only_
shared surface needed, and they are the seam this doc proposes.

## Client placement (updated consensus)

- **`@worlds/libsql`** — production data-plane backend (worlds-api uses it
  today). Keeps its name and its LibSQL vector + FTS5 identity.
- **`@worlds/sqlite`** — zero-dependency local backend for the "local file +
  search" product goal. New package (or `@worlds/sdk/sqlite` subpath). Keyword
  search in v1; full hybrid RRF via `sqlite-vec` or JS cosine later.
- **`@worlds/sdk`** — interfaces + shared orchestration + in-memory RDF/JS
  backend + the four strategy-object interfaces.
- **`@wazoo/sparql-engine`** — engine + `SqliteStore` quad primitive. Stays a
  primitive; does not grow a search index.

### API consumers

- **worlds-api** — already uses `@worlds/libsql` (which wraps `@worlds/sdk`); no
  direct `@worlds/sdk` dependency is needed.
- **wazoo-api** — platform plane; uses the generated **`@worlds/client`** HTTP
  client for its admin-keyed calls to worlds-api, not raw `fetch`, and not the
  embeddable `@worlds/sdk`.

## Migration path

1. Extract the four strategy-object interfaces into `@worlds/sdk` (types only;
   no behavior moves yet).
2. Refactor `@worlds/libsql` to implement them (`LibsqlConnectionDriver`,
   `LibsqlSchemaBuilder`, `LibsqlQuadStoreBackend`, `LibsqlSearchQueryBuilder`)
   without changing behavior.
3. Add `@worlds/sqlite` with `SqliteConnectionDriver`, `SqliteSchemaBuilder`,
   `SqliteQuadStoreBackend` (over `@wazoo/sparql-engine/sqlite`), and a keyword
   signal adapter (`SqliteSearchQueryBuilder`), wired by `createSqliteClient`.
4. Add the SQLite vector signal as a strategy swap: `sqlite-vec` `vec0` behind
   `loadExtension`, or a zero-extension JS cosine scan. Fusion stays in the
   shared Worlds layer.

## Non-goals

- No attempt to share the vector or FTS5 SQL across LibSQL and SQLite.
- No rename of `@worlds/libsql`; its identity is "LibSQL/Turso with LibSQL
  vector + FTS5 search".
- No new `rdfjs-store-sqlite` repo that swallows both; that would drag
  `@libsql/client`, embeddings, and TF.js into a package that
  `SqliteStore`-style consumers must never depend on.
