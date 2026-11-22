# SQL commit core: design and outcome (layer 2 of #265)

**Status:** Implemented in every SQL backend; two deliberate divergences remain
(section 8) · **Designed:** 2026-11-19 · **Updated:** 2026-11-21 · **Issues:**
[#265](https://github.com/wazootech/worlds-sdk-ts/issues/265) (tracking),
[#267](https://github.com/wazootech/worlds-sdk-ts/issues/267) (this design),
[#266](https://github.com/wazootech/worlds-sdk-ts/issues/266) (layer 1, merged
in [#271](https://github.com/wazootech/worlds-sdk-ts/pull/271))

Layer 1 shared the pure logic (`preparePatch`, `selectNovelQuads`,
`planSearchIndexing`, `chunkAndEmbedQuads`, `runCommitConformanceSuite`). Layer
2 gives the SQL backends one commit sequence with one failure policy instead of
four copies. It was designed from the code of `worlds-libsql` (the reference,
including [#66](https://github.com/wazootech/worlds-libsql/pull/66)),
`worlds-sqlite`, `worlds-cloudflare` (D1) and `worlds-postgres` on 2026-11-19,
and every backend has since adopted it. This document now records what was built
and, for each difference between backends, whether it was removed or kept and
why. The tracking issue's principle governs: the backends do approximately the
same things, and a difference stays only when the platform forces it and a
factory option expresses it.

The guarantees below describe each backend's `main` on 2026-11-21 (read from the
merged code); a published release may lag it.

## 1. Where the core lives (resolved: option A)

[`ARCHITECTURE.md`](../ARCHITECTURE.md) records an accepted decision
(2026-08-18, "Durable-backend seam: removed from `@worlds/sdk`"): the sdk ships
zero SQL, and a provider-seam subpath must not be re-added in review. Option A
honoured it and was built; option B (a driver interface in `@worlds/sdk`) was
not.

- The core is `@worlds/sqlite/sql-core` (`commitSqlPatch`,
  `rebuildSqlSearchIndex`), built in
  [worlds-sqlite#57](https://github.com/wazootech/worlds-sqlite/pull/57) and
  published in `@worlds/sqlite` 0.7.4. It is held to the existing
  `sql-core:purity` gate: it imports `@worlds/sdk` and `@rdfjs/types` only,
  never a driver.
- Consumers: sqlite ([#59](https://github.com/wazootech/worlds-sqlite/pull/59)),
  libsql ([#70](https://github.com/wazootech/worlds-libsql/pull/70)), D1
  ([#91](https://github.com/wazootech/worlds-cloudflare/pull/91)) and Postgres
  ([#54](https://github.com/wazootech/worlds-postgres/pull/54)). Postgres
  reversed its earlier "layer 1 only" decision there (it had been deliberately
  outside `sql-core`;
  [#53](https://github.com/wazootech/worlds-postgres/issues/53)).
- IndexedDB has no SQL, so it consumes the layer 1 helpers and gets the same
  semantics in one IndexedDB transaction
  ([worlds-indexeddb#36](https://github.com/wazootech/worlds-indexeddb/pull/36)).
- Every backend pins `@worlds/sdk` `^0.9.1`, and the three SQL consumers other
  than sqlite pin `@worlds/sqlite` `^0.7.4`, so the sdk pins that were far apart
  on 2026-11-19 have converged.

## 2. What the backends do

Identical across backends (verified by reading the code):

- Both sides of a patch go through `filterQuads` and `hashQuads`; there is no
  deduplication within a patch; deletions apply before insertions.
- A quad is novel if it is not stored, or if the same patch also deletes it.
- The `Transaction` commit hook, `importViaTransaction` and the export path are
  the same SDK helpers.
- Since the adoptions: chunking and embedding run before any write; an embedding
  failure throws and writes nothing; the replace-import wipe, deletions, quad
  inserts and chunk rows are one statement list; the shared fallback cleanup
  applies above the atomic limit (section 4).

Divergences. Items 1 to 9 were found while building #271; items 10 to 15 while
designing this core. The table states what is true today; section 8 records what
changed and what stays.

| #  | Divergence                       | libsql                                                                                        | sqlite                                                                | D1                                                                                               | Postgres                                                                                  |
| -- | -------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1  | Identity for the presence lookup | content hash                                                                                  | term key (`skey, pkey, okey, gkey`)                                   | content hash, scoped by `worldId`; asserted rows only when inference is on                       | term key; one `json_to_recordset` join, so nothing to chunk                               |
| 2  | Replace-import wipe              | first statements of the commit's batch                                                        | first statements of the commit's batch                                | first statements of the commit's batch; a commit over the batch size takes the fallback          | first statement of the commit's SQL transaction                                           |
| 3  | Default `searchIndexOnImport`    | `incremental`                                                                                 | `incremental`                                                         | `incremental` (option `searchIndexOnImport`)                                                     | `incremental` (option `searchIndexOnImport`)                                              |
| 4  | Write order                      | chunk and embed, then write                                                                   | chunk and embed, then write                                           | chunk and embed, then write                                                                      | chunk and embed, then write                                                               |
| 5  | Embedding failure                | throws                                                                                        | throws                                                                | throws                                                                                           | throws                                                                                    |
| 6  | Embedding de-duplication         | shared helper                                                                                 | shared helper                                                         | shared helper                                                                                    | shared helper                                                                             |
| 7  | Vector length check              | yes (`vectorDimensions` from the query builder)                                               | yes (same)                                                            | yes (same)                                                                                       | yes (`vectorDimensions`, default 1536)                                                    |
| 8  | Keyword text normalisation       | shared `buildChunkFtsValue`                                                                   | shared `buildChunkFtsValue`                                           | shared `buildChunkFtsValue`                                                                      | generated `tsvector` column                                                               |
| 9  | Vector support                   | in-DB vector column                                                                           | no embedding service when the vector table is unsupported             | external Vectorize index                                                                         | pgvector column                                                                           |
| 10 | What one batch holds             | `maxAtomicStatements` 10,000, then batches of `maxWriteBatchSize` 500                         | same limits (`connection.batch` is one `BEGIN IMMEDIATE` transaction) | one `batch()` call; `maxWriteBatchSize` 100 is both the atomic limit and the fallback batch size | one SQL transaction of any size (`maxAtomicStatements` is `Number.MAX_SAFE_INTEGER`)      |
| 11 | Cleanup after a failed fallback  | shared: removes the novel quads and their chunks                                              | shared: same                                                          | shared: removes the novel quads and their chunks                                                 | not reachable (the fallback is never taken)                                               |
| 12 | Out-of-store vector index        | none                                                                                          | none                                                                  | Vectorize sync after the D1 write (`afterWrite`), purge after a replace or deferred rebuild      | none                                                                                      |
| 13 | Tenancy and derived data         | none                                                                                          | none                                                                  | `worldId` on every statement; the inference planner adds and removes derived quads               | none                                                                                      |
| 14 | Full rebuild                     | `rebuildSqlSearchIndexWithCounts`, scoped when `include`/`exclude` are set (worlds-libsql#72) | `rebuildSqlSearchIndex`                                               | `rebuildSqlSearchIndex`                                                                          | `rebuildSqlSearchIndex`, one SQL transaction per page; keyset paging                      |
| 15 | Write serialisation              | remote batch                                                                                  | `BEGIN IMMEDIATE`                                                     | remote batch                                                                                     | `sql.begin` per batch; `PostgresRdfjsStore` also keeps an in-process `enqueueWrite` queue |

IndexedDB, for completeness: layer 1 helpers, quads, deletions, replace wipe and
chunk rows in one readwrite transaction (`atomic: true`, a failed write keeps
the old graph), embedding before that transaction because it auto-commits across
an await of a non-IndexedDB promise, default `incremental`, embedding failure
throws (the option `onEmbeddingFailure` no longer exists), and a deferred import
reindexes once afterwards.

Facts that bound the design:

- **SQLite can do the atomic path.** `SqliteConnectionDriver.batch` is a real
  transaction, which answered the question left open in the sqlite adoption
  issue.
- **D1's atomic unit is one `batch()` call, and its size is a choice.** The
  source says Cloudflare documents no per-batch statement cap, so 100 is a
  chosen chunk size (100 is D1's bound-parameter limit per statement), not a
  documented limit. Vectorize writes are outside D1 altogether.
- **Postgres needs no batch machinery.** `executeBatch` is one transaction, so
  `commitSqlPatch` always takes its single-batch path.
- **`D1BatchExecutor` is off the commit path.** D1 commits no longer use it; it
  remains for `D1RdfjsStore`'s direct patch path and the inference backfill.

## 3. Interfaces (as built)

The sketch in the first version of this document shipped nearly as written. The
source of truth is `worlds-sqlite/src/sql-core/commit/commit-types.ts`; nothing
here is exported from `@worlds/sdk`.

- **`SqlCommitDriver<S>`**: `maxAtomicStatements`, `writeBatchSize`,
  `executeBatch(statements)` (all or nothing; a rejection means nothing in the
  call applied), `lookupExisting(keys)` and `streamQuads({ after, pageSize })`.
  `maxAtomicStatements: 0` declares a backend that cannot write a commit
  atomically at all.
- **`SqlDialect<S>`**: `keyOf`, `buildWipe`, `buildClearChunks` (added to the
  sketch, for a full rebuild), `buildDeletions`, `buildInserts`,
  `buildChunkRows`, `buildCleanup`. Table layout, term keys, `worldId`, vectors
  and inference live here.
- **`SqlCommitOptions`** (all optional): `filter`, `searchIndexOnImport`,
  `defaultSearchIndexOnImport` (every backend takes `"incremental"`),
  `projection` (the SDK's `ChunkAndEmbedOptions`; without it no chunks are
  written), `maxAtomicStatements` and `writeBatchSize` (they can lower the
  driver's limits, never raise them), `rebuildPageSize`, and
  `afterWrite(summary)` for work that cannot join the batch.
- `commitSqlPatch` returns a `SqlCommitSummary` (`novelQuads`, `chunkRows`,
  `rebuilt`).

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
   An embedding failure always throws and writes nothing on either path.
5. Build one statement list: wipe (replace imports), deletions, deletes and
   inserts for the novel quads, chunk rows.
6. Write it:
   - **Atomic path.** If the list has at most `maxAtomicStatements` statements,
     run one `executeBatch`. It commits or rolls back as a whole, so there is no
     cleanup and no double-failure case. For a replace import the old graph
     survives a failure (`replaceImportFailure: "keeps-old-graph"`).
   - **Fallback path.** Otherwise write batches of `writeBatchSize`. This is not
     atomic. If a later batch fails, run `dialect.buildCleanup` for the novel
     quads written so far. The cleanup cannot restore deletions or a wipe an
     earlier batch already applied (`replaceImportFailure: "empties-graph"`). A
     failure in the first batch wrote nothing and runs no cleanup. If the
     cleanup also fails, throw an `AggregateError` carrying both errors, and say
     the quads and index may be inconsistent. This is the contract from
     worlds-libsql#66.
7. Run `afterWrite` (outside the batch), then, if step 3 asked for it, one full
   rebuild via `driver.streamQuads` (`rebuildSqlSearchIndex`: each page is
   chunked and embedded before it is written, and each write batch is atomic,
   but the rebuild as a whole is not, so a rerun repairs a partial one).

A backend that cannot be atomic at all sets `maxAtomicStatements: 0`. D1's limit
is its write batch size (100), so a larger D1 commit takes the fallback, and a
backend that declares `atomic: false` in the conformance suite promises the
weaker contract the suite checks.

### Shared prepare step

Steps 1 to 4 were still copied into each backend (`commitSqlPatch` and
IndexedDB's `createProjectingCommit`), so the SDK now owns them as
`prepareCommit(patch, options)` in `@worlds/sdk/search-index`. It takes the
filter, the transaction context, the mode and the backend default, `keyOf` and
`lookupExisting`, and the `projection` options, and returns
`{ prepared, plan, novel, rows, replacing }`. A backend writes `prepared`
deletions, `novel` insertions and `rows` (wiping first when `replacing`) and
reindexes when `plan.reindexAfterCommit`. The filter applies to what is stored
and what is projected. A deferred import returns empty `rows`, and an embedding
failure rejects before anything is written. IndexedDB passes
`selectNovel: "when-projecting"`, because its store deduplicates writes itself.
The conformance reference store already uses it. It is unreleased: adopting it
in `@worlds/sqlite` and `@worlds/indexeddb` waits on the next SDK release.

### Conformance suite

`runCommitConformanceSuite` (`@worlds/sdk/testing`) checks a backend's declared
contract (`atomic`, `embeddingFailure`, `replaceImportFailure`,
`defaultSearchIndexOnImport`, and the optional `laterWriteFailure`). All five
backends run it. Cases: the three `searchIndexOnImport` modes, the default mode,
idempotent writes, delete and re-insert, embedding failure, write failure,
replace-import failure, and, when the subject provides the hook below, a later
write failure.

**The later-write case.** `failNextWrite` hits a commit's first write, so it
cannot tell an atomic backend from a non-atomic one: with a single batch there
is nothing to leave behind. The optional subject hook `failLaterWrite(): void`
makes the next commit fail once on a write that comes after that commit's quad
writes (a chunk-row write inside the same transaction or batch, or a later batch
of a chunked commit). The case then checks:

- the commit rejects, and the previously committed quad survives;
- `atomic: true`: stored quads and chunk rows are exactly the prior state;
- `atomic: false`: the same by default, because the shared fallback cleans up. A
  backend that cannot clean up declares
  `laterWriteFailure: "keeps-written-quads"`, which weakens the check to "no
  chunk row refers to a quad that is not stored";
- the store accepts a commit afterwards.

It is additive: a subject without `failLaterWrite` keeps its existing cases, the
case is left out of `report.results` (so a count of nine results stays nine) and
the reason is added to the new optional `report.notes`. The commit that fails
inserts two novel textual quads under `incremental`, so a chunk write follows
the quad writes; a chunked backend sizes its batches so the failing write is not
the first one. A reference in-memory pipeline in `src/testing` proves the case
catches a store that keeps quads, or leaves orphan chunks, after the failure.

## 5. What stays backend-specific

SQL dialect, table layout and term keys; vector storage (in-DB column,
sqlite-vec, pgvector, Vectorize); statement limits; connection and transaction
mechanics; `worldId` scoping and the inference planner; the keyword query
builders and the search-time code; and any default that is a product decision
(none left for the import default). `ARCHITECTURE.md` already says quad storage
layout and each vector dialect stay backend-local; this design keeps that.

## 6. Export and versioning

- The core is exported as `@worlds/sqlite/sql-core`, a driver-free module held
  to the `sql-core:purity` gate. Option B (a new `@worlds/sdk` subpath) would
  have required amending the 2026-08-18 decision; it was not needed.
- Backends consume published packages, so the order is always: publish the
  core's package, bump each backend's pin, then adopt. A patch version is used
  for an additive release.
- The core stays additive: new optional fields, never a changed meaning, so a
  backend on an older core keeps working. The same holds for the suite: the
  later-write hook and `laterWriteFailure` are optional, and `@worlds/sdk` must
  be released before a backend can import them.

## 7. Consistency with #102 and with Postgres

- **#102** asks whether the RDF/JS store seam (`rdfjs-store`) is public. The
  core lives next to, not inside, that seam, and consumes only `Transaction`,
  `TransactionContext` and `Patch`, which are already public. Whatever #102
  decides about `committing-rdfjs-store` and the import/export bridge does not
  change the core. (Not re-checked on 2026-11-21.)
- **Postgres** is on the core. It commits through `commitSqlPatch` over a
  transactional driver and a Postgres dialect, projects chunk rows at commit
  under the same `searchIndexOnImport` modes, and runs the conformance suite
  with `atomic: true`, `embeddingFailure: "throws"`,
  `replaceImportFailure: "keeps-old-graph"` and default `incremental`. What
  stays Postgres-specific is the search side: generated `tsvector`, pgvector
  cosine and RRF fusion. The statements in `ARCHITECTURE.md` that Postgres
  "deliberately does not consume `sql-core`" were stale and are corrected with
  this change.

## 8. Per-backend outcome

"Converged" means the backends now behave the same and the difference is gone.
"Kept" means it stays, with the reason and where it is expressed.

| #  | Divergence               | Outcome                                                                                                     | Still different, and why                                                                                                                                                                                                                                                                                                                                                                                                 |
| -- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | Lookup identity          | Kept, behind `dialect.keyOf`                                                                                | Hash (libsql, D1) versus term key (sqlite, Postgres) follows each table layout; not observable through the suite. A choice, not a platform limit.                                                                                                                                                                                                                                                                        |
| 2  | Replace-import wipe      | Converged: the wipe joins the commit's statement list everywhere                                            | Above the atomic limit (D1 over 100, libsql and sqlite over 10,000) the fallback applies and a failed replace leaves an empty graph (`empties-graph`).                                                                                                                                                                                                                                                                   |
| 3  | Default mode             | Converged on `incremental` everywhere, D1 included (worlds-cloudflare#93)                                   | None. Measured on miniflare (worlds-cloudflare#92): `incremental` issues the same statements, one fewer `batch()` call and fewer reads than `deferred`, embeds only the novel quads, and writes nothing when embedding fails. Workers limits do not force `deferred`: its rebuild runs in the same invocation and spends more of the same per-invocation subrequest budget. `"deferred"` stays an option, not a default. |
| 4  | Write order              | Converged: embed before any write (sqlite and D1 used to write quads first)                                 | None                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5  | Embedding failure        | Converged: throws, nothing written, on every backend (D1 flipped from `degrades`, decision 2026-11-20)      | None. `onEmbeddingFailure: "degrade"` and `embeddingError` were removed from `chunkAndEmbedQuads` (worlds-sdk-ts#280).                                                                                                                                                                                                                                                                                                   |
| 6  | De-duplication           | Converged on the shared helper                                                                              | None                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7  | Vector length check      | Converged: every backend passes `vectorDimensions` to the shared helper                                     | None                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8  | Keyword text             | Kept                                                                                                        | Postgres uses a generated column; the others use `buildChunkFtsValue`. Dialect-specific.                                                                                                                                                                                                                                                                                                                                 |
| 9  | Vector support           | Kept                                                                                                        | Platform-forced: in-DB column, sqlite-vec, pgvector or Vectorize.                                                                                                                                                                                                                                                                                                                                                        |
| 10 | Batch capacity           | Converged on one policy (atomic to the limit, then chunked); the limits are driver values                   | libsql and sqlite 10,000/500; D1 100/100 (a chosen chunk size); Postgres unlimited (one transaction). The sqlite 10,000-statement flush is gone.                                                                                                                                                                                                                                                                         |
| 11 | Cleanup after failure    | Converged: the shared fallback removes the novel quads and their chunks (D1 used to remove chunk rows only) | None                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 12 | External vector index    | Kept, via `afterWrite`                                                                                      | Platform-forced: Vectorize is not transactional with D1, so vector sync after the D1 write is never atomic with it. A failure is logged drift that a reindex repairs.                                                                                                                                                                                                                                                    |
| 13 | Tenancy and derived data | Kept, inside the dialect                                                                                    | Product feature of the hosted D1 backend.                                                                                                                                                                                                                                                                                                                                                                                |
| 14 | Full rebuild             | Converged for sqlite, libsql, D1 and Postgres (`rebuildSqlSearchIndex`; libsql in worlds-libsql#72)         | None for the SQL backends. IndexedDB keeps its own page loop because it has no SQL.                                                                                                                                                                                                                                                                                                                                      |
| 15 | Write serialisation      | Kept                                                                                                        | Per-transport mechanics (remote batch, `BEGIN IMMEDIATE`, `sql.begin`).                                                                                                                                                                                                                                                                                                                                                  |

Converged defaults, in one line: `searchIndexOnImport` `incremental`, embedding
failure throws with nothing written, atomic commit wherever the driver can,
atomic replace import on the atomic path.

Remaining deliberate divergences, from the table above:

1. **D1 over 100 statements** takes the non-atomic chunked fallback (with
   cleanup), and **Vectorize sync is never atomic with D1** (platform-forced).

## 9. Rollout (done) and adopter checklist

Merged, in order: layer 1 (#271, released as `@worlds/sdk` 0.9.1) and its
adoptions (worlds-libsql#69, worlds-sqlite#56, worlds-cloudflare#89,
worlds-indexeddb#34, worlds-postgres#52); the core (worlds-sqlite#57, published
as 0.7.4) and its adoptions (worlds-sqlite#59, worlds-libsql#70,
worlds-cloudflare#91); then Postgres on the core (worlds-postgres#54) and
IndexedDB convergence (worlds-indexeddb#36). Released 2026-11-21: `@worlds/sdk`
0.10.0, `@worlds/sqlite` 0.8.0, `@worlds/indexeddb` 0.3.0, `@worlds/postgres`
0.4.0, `@worlds/libsql` 0.7.0, `@worlds/cloudflare` 0.15.0.

A new backend adopting the core, or a change to an existing one, should:

- run `runCommitConformanceSuite` with its declared contract, and provide
  `failLaterWrite` so atomic and non-atomic backends are told apart;
- say which divergences from section 8 it keeps and why, as options not forks;
- list its downstream dependents and merge order, name the gates it could not
  observe (a real Turso or D1 deployment, real embedding services), and avoid
  load tests against real Cloudflare (use miniflare).

Every backend now provides `failLaterWrite` through its conformance subject, so
the tenth case ("later-write failure follows the contract") runs everywhere
(worlds-sqlite#63, worlds-libsql#73, worlds-postgres#57, worlds-cloudflare#95,
worlds-indexeddb#39; tests only, no release, no divergence found). What each
injected failure hits:

| Backend   | Injected failure                                                                                                                           | Contract                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| sqlite    | The first `chunks` insert after the quad insert in the batch fails inside the real `BEGIN IMMEDIATE` transaction, which rolls back.        | atomic, `restores-prior-state`                                |
| libsql    | The first `chunks` insert of the next `batch()` is rewritten to hit a missing table; the real atomic batch rolls back.                     | atomic. The chunked fallback is not exercised by this subject |
| D1        | The first `chunks` insert in a write batch fails on miniflare's D1: rollback on the atomic path, compensating cleanup on the chunked path. | `restores-prior-state` on both paths; real D1 not verified    |
| Postgres  | The first `worlds_search_chunks` insert after a `worlds_quads` insert throws inside the open PGlite transaction, which rolls back.         | atomic, `restores-prior-state`; real Postgres not verified    |
| IndexedDB | The next `put` into the chunk store throws inside the single readwrite transaction after the quad puts, so the transaction aborts.         | atomic, `restores-prior-state`                                |

Each backend also pins the injection with a statement-order test so the case
cannot pass vacuously. The sqlite core's own suite
(`src/sqlite/commit-core/commit-core-conformance.test.ts`) also runs it now,
over a fake store that applies statements in order, for both an atomic driver
and a chunked-fallback driver (worlds-sqlite#64).

## 10. Open and resolved

Resolved since the first version:

- Option A or B: **A**.
- Whether Postgres gains commit-time projection: **yes**, with a
  `searchIndexOnImport` option (worlds-postgres#54).
- D1's cleanup (chunks only, or novel quads and chunks): **shared, novel quads
  and chunks**.
- Whether D1's 100-statement cap is documented: **no**; it is a chosen chunk
  size. D1's `batch()` atomicity is asserted by the source and exercised only
  through an injected failure wrapper; it was not verified against a real D1 or
  Cloudflare's documentation.
- Embedding failure: **throws on every backend**. `onEmbeddingFailure` and
  `ChunkAndEmbedResult.embeddingError` are gone (worlds-sdk-ts#280, released in
  `@worlds/sdk` 0.10.0; worlds-indexeddb#37, worlds-sqlite#61,
  worlds-postgres#55).
- D1's `searchIndexOnImport` default: **`incremental`**, like every other
  backend (worlds-cloudflare#93).
- libsql `reindex()`: **on the shared scoped rebuild** (worlds-libsql#72).
- Reindex parity, found by writing the same tests against every backend (merged,
  not yet released): sqlite did not pass `scope`, so an `include` or `exclude`
  reindex deleted every out-of-scope chunk row (worlds-sqlite#65); IndexedDB had
  the same bug plus a commit that ignored `include`/`exclude`, orphan chunk rows
  when indexing was off, and a `processedQuadCount` that counted only matching
  quads (worlds-indexeddb#40); Postgres counted only filtered quads
  (worlds-postgres#58); D1 left the stale chunk row of a deleted quad after an
  unscoped reindex (worlds-cloudflare#97). All five now agree: scoped replaces
  only in-scope rows, an empty scope is unscoped, `processedQuadCount` is every
  quad scanned.
- The core's later-write failure path (compensating cleanup in the chunked
  fallback) is exercised through the shared case by sqlite's fake store
  (worlds-sqlite#64). Cleanup that itself fails (`AggregateError`) is not.

Still open:

- Request-size limits for a 10,000-statement batch against remote Turso: not
  measured.
- The later-write case against the chunked fallback of libsql, and against a
  real D1 and a real Postgres server (section 9): not exercised.
