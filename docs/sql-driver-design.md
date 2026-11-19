# SQL commit core: design (layer 2 of #265)

**Status:** Proposed, needs one decision (section 1) · **Date:** 2026-11-19 ·
**Issues:** [#265](https://github.com/wazootech/worlds-sdk-ts/issues/265)
(tracking), [#267](https://github.com/wazootech/worlds-sdk-ts/issues/267) (this
design), [#266](https://github.com/wazootech/worlds-sdk-ts/issues/266) (layer 1,
merged in [#271](https://github.com/wazootech/worlds-sdk-ts/pull/271))

Layer 1 shared the pure logic (`preparePatch`, `selectNovelQuads`,
`planSearchIndexing`, `chunkAndEmbedQuads`, `runCommitConformanceSuite`). This
document designs layer 2: one commit sequence, with one failure policy, that the
SQL backends run instead of each re-implementing it. It is written from the
actual code of `worlds-libsql` (reference, includes
[#66](https://github.com/wazootech/worlds-libsql/pull/66)), `worlds-sqlite`,
`worlds-cloudflare` (D1) and `worlds-postgres`, all on `main` on 2026-11-19.

## 1. Decision needed first: where the core lives

[`ARCHITECTURE.md`](../ARCHITECTURE.md) records an accepted decision
(2026-08-18, "Durable-backend seam: removed from `@worlds/sdk`"): **the sdk
ships zero SQL**, and a provider-seam subpath must not be re-added in review. A
driver interface in `@worlds/sdk` would be exactly that. The same document says
`@worlds/sqlite` is the source of truth for SQLite-family SQL logic and
publishes a driver-free `./sql-core` layer (enforced by `sql-core:purity`) that
`@worlds/libsql` and `@worlds/cloudflare` already consume. `@worlds/postgres`
deliberately does not consume it.

| Option                                                              | Fits the accepted decision | Reaches                                                               | Cost                                                                                           |
| ------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **A (recommended)** core in `@worlds/sqlite/sql-core`               | Yes                        | sqlite, libsql, D1 (the three that already share it)                  | Postgres is not covered by the core (see section 7)                                            |
| B core in `@worlds/sdk` (for example `@worlds/sdk/sql-commit-core`) | No, supersedes it          | All four SQL backends, a future SQL backend with no sqlite dependency | Reverses an accepted decision; the sdk gains a SQL-shaped public contract with three consumers |

This document recommends **A** and is written so that B is a move of one module,
not a redesign: the core only depends on the driver and dialect interfaces in
section 3 and on the layer 1 helpers, which are already in `@worlds/sdk`. Layer
1 is unaffected either way, because it contains no SQL.

## 2. What the backends do today

Identical or near-identical (verified by reading the code):

- Filter both sides with `filterQuads`, hash with `hashQuads`, no deduplication
  within a patch, deletions applied before insertions.
- A quad is novel if it is not stored, or if the same patch also deletes it.
- The commit hook on `Transaction`, `importViaTransaction`, and the export path
  are the same SDK helpers.

Divergences. Items 1 to 9 were first found while building #271; items 10 to 15
are new.

| #  | Divergence                                                               | libsql (reference)                                                                 | sqlite                                                                                                                                                      | D1                                                                                              | Postgres                                                             |
| -- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1  | Identity used for the presence lookup                                    | content hash                                                                       | term key (`skey, pkey, okey, gkey`)                                                                                                                         | content hash, scoped by `worldId`, ignores derived rows when inference is on                    | term key, no lookup (`INSERT ... ON CONFLICT DO UPDATE`)             |
| 2  | Replace-import wipe                                                      | first statements of the same atomic batch; presence lookup skipped                 | separate earlier batch; hashing happens after the wipe                                                                                                      | separate earlier batch; hashing happens before the wipe                                         | first statement of the same SQL transaction                          |
| 3  | Default `searchIndexOnImport`                                            | `incremental`                                                                      | `incremental`                                                                                                                                               | `deferred`                                                                                      | none: chunks are written only by `reindex()`                         |
| 4  | Write order                                                              | chunk and embed first, then one batch (since #66)                                  | quads first, then project chunks                                                                                                                            | quads first, then project chunks                                                                | quads only on commit                                                 |
| 5  | Embedding failure                                                        | throws                                                                             | throws                                                                                                                                                      | degrades to keyword-only chunks                                                                 | throws (inside `reindex()`)                                          |
| 6  | Embedding de-duplication (the shared `chunkAndEmbedQuads` de-duplicates) | embeds de-duplicated texts                                                         | embeds de-duplicated texts                                                                                                                                  | embeds each chunk's text                                                                        | embeds each chunk's text                                             |
| 7  | Vector length check                                                      | yes                                                                                | yes                                                                                                                                                         | no                                                                                              | yes                                                                  |
| 8  | Keyword text normalisation                                               | shared `buildChunkFtsValue`                                                        | shared `buildChunkFtsValue`                                                                                                                                 | shared `buildChunkFtsValue`                                                                     | generated `tsvector` column                                          |
| 9  | Vector support                                                           | in-DB vector column                                                                | skips embedding when the vector table is unsupported (`vectorSupported`)                                                                                    | external Vectorize index                                                                        | pgvector column                                                      |
| 10 | What one batch can hold                                                  | `maxAtomicStatements` 10,000, then chunks of `maxWriteBatchSize` 500 (#66)         | `connection.batch` is atomic (`BEGIN IMMEDIATE ... COMMIT`), but the executor flushes every 10,000 staged statements, so a larger commit is several batches | one `batch()` call capped at 100 statements; executor is fail-closed after a mid-stream failure | one SQL transaction of any size (`json_to_recordset`, one parameter) |
| 11 | Cleanup after a failed projection                                        | none needed on the atomic path; above the limit deletes the novel quads and chunks | deletes the novel quads and their chunks                                                                                                                    | deletes the chunk rows only; the quads stay                                                     | not applicable                                                       |
| 12 | Out-of-store vector index                                                | none                                                                               | none                                                                                                                                                        | Vectorize sync after the D1 write, a purge after a replace import, drift logged                 | none                                                                 |
| 13 | Tenancy and derived data                                                 | none                                                                               | none                                                                                                                                                        | `worldId` on every statement, inference planner adds and removes derived quads                  | none                                                                 |
| 14 | Chunk row writes during rebuild                                          | one batch per commit; `rebuildLibsqlSearchIndexFromQuads` for deferred             | `rebuildSqliteSearchIndexFromQuads`                                                                                                                         | `rebuildD1SearchIndexFromQuads`                                                                 | keyset-paged; one `INSERT` per chunk, not in a transaction           |
| 15 | Write serialisation                                                      | remote batch                                                                       | `BEGIN IMMEDIATE`                                                                                                                                           | remote batch                                                                                    | in-process `enqueueWrite` queue plus `sql.begin`                     |

Facts that bound the design:

- **SQLite can do the atomic path.** `SqliteConnectionDriver.batch` is a real
  transaction, so the question left open in the sqlite adoption issue is
  answered: it can use the atomic batch.
- **D1 cannot do a large atomic commit.** Its atomic unit is one `batch()` call
  of at most 100 statements (taken from the code comments in
  `d1-batch-executor.ts`, not verified against Cloudflare's documentation), and
  Vectorize writes are outside D1 altogether.
- **Postgres does not need the batch machinery.** It already commits in one
  transaction of any size.
- **SDK pins are far apart.** `@worlds/sdk` is pinned at `^0.6.1` in sqlite and
  postgres, `^0.7.0` in libsql and indexeddb, and `^0.9.0` in cloudflare. In
  semver `^0.y.z` does not cross a minor version, so each adoption also moves
  across several SDK minors and must absorb those changes (section 8).

## 3. Interfaces (sketch)

Documentation only: none of this is exported from `@worlds/sdk` today. Names are
placeholders for the core's home (`@worlds/sqlite/sql-core` under option A).

```ts
/** A statement the backend can run; opaque to the core. */
type Statement = unknown;

/**
 * SqlCommitDriver is the backend's execution surface. The core never builds SQL
 * and never opens a connection.
 */
interface SqlCommitDriver<S = Statement> {
  /** Most statements `executeBatch` runs atomically (all or nothing). */
  readonly maxAtomicStatements: number;

  /** Statements per batch once a commit exceeds the atomic limit. */
  readonly writeBatchSize: number;

  /** Runs the statements as one atomic unit, or rejects with nothing applied. */
  executeBatch(statements: readonly S[]): Promise<void>;

  /** Which of `keys` the store already holds; the backend chunks its own IN clauses. */
  lookupExisting(keys: string[]): Promise<Set<string>>;

  /** Pages every stored quad in a stable order, for a full rebuild. */
  streamQuads(
    request: { after?: unknown; pageSize: number },
  ): Promise<{ quads: rdfjs.Quad[]; next?: unknown }>;
}

/**
 * SqlDialect turns the core's decisions into the backend's statements. This is
 * where table layout, term keys, `worldId`, vectors and inference live.
 */
interface SqlDialect<S = Statement> {
  /** keyOf is the identity the store recognises a quad by (slice 1's `keyOf`). */
  keyOf(quad: rdfjs.Quad, hash: string): string;
  buildWipe(): S[];
  buildDeletions(keys: string[], hashes: string[]): S[];
  buildInserts(quads: rdfjs.Quad[], keys: string[], hashes: string[]): S[];
  buildChunkRows(rows: EmbeddedChunk[]): S[];
  /** Removes novel quads and their chunks, for the non-atomic fallback. */
  buildCleanup(keys: string[], hashes: string[]): S[];
}

/** What the backend promises, shared with the conformance suite. */
interface SqlCommitCoreOptions extends CommitConformanceContract {
  maxLookupChunkSize?: number;
  searchIndexOnImport?: SearchIndexOnImport;
  /** Hook for work that cannot join the batch (Vectorize, derived quads). */
  afterWrite?: (written: NovelQuads) => Promise<void>;
}
```

## 4. The commit sequence and the atomicity contract

`commitSqlPatch(patch, context, driver, dialect, options)` runs, in order:

1. `preparePatch` (filter and hash). Nothing has touched the store, so a failure
   here, including a hashing error, leaves it untouched, even before a
   replace-import wipe.
2. `selectNovelQuads` with `driver.lookupExisting`, `dialect.keyOf`, and
   `replacing` set for a replace import.
3. `planSearchIndexing` decides whether to project chunks in this commit and
   whether a full rebuild follows.
4. `chunkAndEmbedQuads` for the novel quads, only when step 3 says to project.
   An embedding failure follows `onEmbeddingFailure` and writes nothing on
   either path.
5. Build one statement list: wipe (replace imports), deletions, inserts for the
   novel quads, chunk rows.
6. Write it:
   - **Atomic path.** If the list has at most `maxAtomicStatements` statements,
     run one `executeBatch`. It commits or rolls back as a whole, so there is no
     cleanup and no double-failure case. For a replace import the old graph
     survives a failure (`replaceImportFailure: "keeps-old-graph"`).
   - **Fallback path.** Otherwise write batches of `writeBatchSize`. This is not
     atomic. If a later batch fails, run `dialect.buildCleanup` for the novel
     quads written so far. The cleanup cannot restore deletions or a wipe an
     earlier batch already applied (`replaceImportFailure: "empties-graph"`). A
     failure in the first batch wrote nothing. If the cleanup also fails, throw
     an `AggregateError` carrying both errors, and say the quads and index may
     be inconsistent. This is the contract from worlds-libsql#66.
7. Run `afterWrite` (outside the batch), then, if step 3 asked for it, one full
   rebuild via `driver.streamQuads`.

A backend that cannot be atomic at all declares `atomic: false` and sets
`maxAtomicStatements` to its real limit (100 for D1). The core then always takes
the fallback path above that limit, and the conformance suite checks the weaker
promise it already supports: no chunk row refers to a quad that is not stored.

## 5. What stays backend-specific

SQL dialect, table layout and term keys; vector storage (in-DB column,
sqlite-vec, pgvector, Vectorize); statement limits; connection and transaction
mechanics; `worldId` scoping and the inference planner; the keyword query
builders and the search-time code; and any default that is a product decision
(D1's `deferred` default). `ARCHITECTURE.md` already says quad storage layout
and each vector dialect stay backend-local; this design keeps that.

## 6. Export and versioning

- **Option A:** exported as `@worlds/sqlite/sql-core/commit` (or alongside the
  existing `./sql-core`), and held to the existing `sql-core:purity` gate: it
  may import `@worlds/sdk`, `@rdfjs/types` and relatives only, never a driver.
- **Option B:** a new `@worlds/sdk` subpath. Requires amending the 2026-08-18
  decision in `ARCHITECTURE.md` in the same change.
- Backends consume published packages, so the order is always: publish the
  core's package, then bump each backend's pin, then adopt. A patch version is
  used for an additive release, matching how 0.9.1 is prepared.
- The core must stay additive: new optional fields, never a changed meaning, so
  a backend on an older core keeps working.

## 7. Consistency with #102 and with Postgres

- **#102** asks whether the RDF/JS store seam (`rdfjs-store`) is public. The
  core lives next to, not inside, that seam, and consumes only `Transaction`,
  `TransactionContext` and `Patch`, which are already public. Whatever #102
  decides about `committing-rdfjs-store` and the import/export bridge does not
  change the core.
- **Postgres** is outside the core, by its own architecture decision and by its
  code: it commits in one SQL transaction, keys quads by term key with an
  upsert, and writes chunks only in `reindex()`. It adopts layer 1 only:
  `chunkAndEmbedQuads` and the conformance suite (with `atomic: true`,
  `embeddingFailure: "throws"`), and decides separately whether to add
  commit-time projection and a `searchIndexOnImport` option.

## 8. Per-backend decisions

"Keep" means the difference stays, expressed as an option or contract field.
"Drop" means the backend adopts the shared behaviour and the PR says so.

| #  | Divergence            | libsql                                                            | sqlite                                       | D1                                                                                 | Postgres                                                                  |
| -- | --------------------- | ----------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1  | Lookup identity       | keep (hash)                                                       | keep (term key via `keyOf`)                  | keep (hash, `worldId`)                                                             | keep (no lookup)                                                          |
| 2  | Replace-import wipe   | reference                                                         | **drop**: wipe joins the atomic batch        | keep: wipe exceeds one 100-statement batch; `empties-graph`                        | n/a (already in one transaction)                                          |
| 3  | Default mode          | keep `incremental`                                                | keep `incremental`                           | keep `deferred`                                                                    | decide in its issue (no option today)                                     |
| 4  | Write order           | reference                                                         | **drop**: embed before write                 | **drop**: embed before write                                                       | n/a                                                                       |
| 5  | Embedding failure     | keep `throws`                                                     | keep `throws`                                | keep `degrades` (explicit contract)                                                | keep `throws`                                                             |
| 6  | De-duplication        | follow the helper                                                 | follow the helper                            | **drop** (adopt the helper's)                                                      | **drop** (adopt the helper's)                                             |
| 7  | Vector length check   | keep                                                              | keep                                         | **drop**: add the check (Vectorize caps dimensions at 1536)                        | keep                                                                      |
| 8  | Keyword text          | keep                                                              | keep                                         | keep                                                                               | keep (generated column)                                                   |
| 9  | Vector support        | keep                                                              | keep (pass no embedding service)             | keep (Vectorize)                                                                   | keep (pgvector)                                                           |
| 10 | Batch capacity        | `10_000` / `500`                                                  | `10_000` / `500` (**drop** the 10,000 flush) | `100` / `100`                                                                      | n/a                                                                       |
| 11 | Cleanup after failure | **drop** the old per-backend cleanup in favour of the shared path | **drop** (shared fallback cleanup)           | open: keep "chunks only" or adopt "novel quads and chunks"; both satisfy the suite | n/a                                                                       |
| 12 | External vector index | n/a                                                               | n/a                                          | keep, via `afterWrite`                                                             | n/a                                                                       |
| 13 | Tenancy / inference   | n/a                                                               | n/a                                          | keep, inside the dialect                                                           | n/a                                                                       |
| 14 | Rebuild               | use `streamQuads`                                                 | use `streamQuads`                            | use `streamQuads`                                                                  | keep its keyset paging; write chunk rows in a transaction per page (open) |
| 15 | Write serialisation   | keep                                                              | keep                                         | keep                                                                               | keep                                                                      |

Open item for the D1 issue: D1's `batch()` atomicity and its 100-statement cap
come from code comments, so the adoption must confirm both against Cloudflare's
current documentation and against miniflare before the contract is declared.

## 9. Rollout

1. **Release layer 1.** Merge and publish `@worlds/sdk` 0.9.1 (PR #272). Each
   backend's layer 1 adoption (worlds-libsql#67, worlds-sqlite#53,
   worlds-cloudflare#87, worlds-indexeddb#33, plus the Postgres issue) needs it.
   Publishing is a confirm-first step.
2. **Decide section 1** (A or B).
3. **Build the core** in its home, with its own tests and the conformance suite
   run against an in-memory driver. Publish it.
4. **Adopt, one backend per PR, in this order:** `worlds-sqlite` (it hosts the
   core under A and is the easiest to run locally), `worlds-libsql` (reference,
   so the diff should be near zero behaviour), then `worlds-cloudflare` (the
   hardest: non-atomic, tenancy, Vectorize).
5. **Postgres** adopts layer 1 independently, as soon as 0.9.1 is published.

Each adoption PR must:

- delete its copy of the logic and say which divergences from section 8 it kept
  and which it dropped;
- run `runCommitConformanceSuite` with its declared contract, including a case
  where the first write fails and one where the cleanup also fails (for the
  fallback path);
- bump its `@worlds/sdk` pin to the release that contains the layer 1 helpers
  and read the CHANGELOG entries for every minor version it crosses (sqlite and
  postgres are at 0.6, libsql and indexeddb at 0.7), listing any change it had
  to absorb;
- run its full CI, state which gates it could not observe (a real Turso or D1
  deployment, real embedding services), and avoid load tests against real
  Cloudflare, using miniflare instead;
- list its downstream dependents and merge order, per the workspace rules for
  cross-repo changes.

## 10. Not determined

- Whether D1's `batch()` is atomic and capped at 100 statements, beyond what the
  code comments say.
- Request-size limits for a 10,000-statement batch against remote Turso.
- Whether Postgres should gain commit-time projection at all.
- Which of options A and B the maintainers choose.
