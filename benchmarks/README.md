# Benchmarks

Performance benchmarks for `@worlds/client`. **Local only** — there is no CI
regression gate; compare results manually on the same OS and Deno version.

| Resource                                                                       | Purpose                                                        |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------- |
| [Discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69) | Canonical post-preload SPARQL quad index perf write-up         |
| [Discussion #45](https://github.com/wazootech/worlds-client-ts/discussions/45) | Historical hydrate+N3 vs libsql crossover (pre-preload)        |
| [#68](https://github.com/wazootech/worlds-client-ts/issues/68)                 | Millions-of-quads production guidance (README + query helpers) |

Do not comment on closed perf threads
([#2](https://github.com/wazootech/worlds-client-ts/issues/2),
[#3](https://github.com/wazootech/worlds-client-ts/issues/3),
[#8](https://github.com/wazootech/worlds-client-ts/issues/8),
[#11](https://github.com/wazootech/worlds-client-ts/issues/11)). File a new
issue with before/after `deno bench` output instead.

**JSR:** [`@worlds/client`](https://jsr.io/@worlds/client) is published on JSR.
Tables below reflect **main** branch methodology (module preload); they are not
a substitute for re-running on your machine.

## Layout

- `*.bench.ts` — runnable benchmarks (`deno bench` discovers these at the repo
  root of `benchmarks/`, not under `shared/`).
- [`shared/`](shared/) — helpers imported by benches (`synthetic-data.ts`,
  `sparql-perf-shared.ts`).

## Run all benchmarks

```bash
deno task bench
```

Or directly:

```bash
deno bench --allow-all --unstable-kv benchmarks/
```

### SPARQL quad index performance (LibSQL + Denokv)

The LibSQL bench is the production-default quad index execute harness. The
Denokv bench runs the **same** preload + selective SPARQL execute methodology
against `DenokvRdfjsStore` — useful for Deno-native comparisons; not the default
when you need hybrid search or fast cold bulk load (see tables below and
discussion #69).

LibSQL:

```bash
deno bench --allow-all benchmarks/sparql-perf-libsql.bench.ts
# or
deno task bench:sparql-perf-libsql
```

Deno KV (requires `--unstable-kv`):

```bash
deno bench --allow-all --unstable-kv benchmarks/sparql-perf-denokv.bench.ts
# or
deno task bench:sparql-perf-denokv
```

**Standard (1k–50k):** separate execute-only benches per backend (`libsqlStore`,
`denokvStore`). Compare backends by running both files on the same machine; do
not mix backends in one bench file.

**Default query shape is selective only** (subject-bound
`SELECT ?p ?o WHERE { <urn:entity:0> ?p ?o }`). Unbound dev-scan (`fullScan`) is
opt-in — it is slow on both backends and not the production hot path:

```bash
# .env or shell
BENCH_HEXASTORE_PERF_FULL_SCAN=1
deno task bench:sparql-perf-libsql:full-scan
deno task bench:sparql-perf-denokv:full-scan
```

Large benches use the same env via `:full-scan` tasks:

```bash
deno task bench:sparql-perf-large-libsql:full-scan
deno task bench:sparql-perf-large-denokv:full-scan
```

**Large (100k–1M):** separate libsql and denokv large benches
([#68](https://github.com/wazootech/worlds-client-ts/issues/68)). Both support
`:reuse` and `:full-scan` tasks; Denokv large preload is still slow — use reuse
for repeat captures, not day-to-day iteration.

Hexastore perf preload uses `searchIndexOnImport: "disabled"` (quads only; the
timed slice is `execute()`). Do **not** call `Client.reindex()` in these
harnesses — it rebuilds FTS/chunks and does not affect execute timings. Batched
quad `INSERT`s speed the untimed preload / `BENCH_REUSE_DB` cache build.

Apps that need `search()` at scale use normal import with inline indexing
(`"incremental"`, the default), `searchIndexOnImport: "deferred"` (rebuild after
each import), or `searchIndexOnImport: "disabled"` plus `await client.reindex()`
once after bulk load.

### SPARQL quad index perf at 100k–1M (opt-in, local only)

[#76](https://github.com/wazootech/worlds-client-ts/issues/76). Not part of
`deno task bench` — preload can take a long time and needs ample RAM (16 GB+ for
1M libsqlStore preload).

```bash
deno task bench:sparql-perf-large-libsql
```

Or with a larger V8 heap if preload OOMs:

```bash
deno bench --allow-all --v8-flags=--max-old-space-size=8192 benchmarks/sparql-perf-large-libsql.bench.ts
```

Deno KV large quad index perf (opt-in; `--unstable-kv`):

```bash
deno task bench:sparql-perf-large-denokv
```

Or:

```bash
deno bench --allow-all --unstable-kv --v8-flags=--max-old-space-size=8192 benchmarks/sparql-perf-large-denokv.bench.ts
```

Module load logs `console.time` lines per scale (`generate`, then each backend).
Only `sparqlEngine.execute()` is timed inside `Deno.bench`. Paste results into
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69).

For full import + search preload timing (not the quad index perf execute table),
use `searchIndexOnImport: "deferred"` on a dedicated bulk-load client (quads
first, search index rebuilt after import), or `searchIndexOnImport: "disabled"`
followed by `await client.reindex()` when you want quads and search repair as
separate timed steps.

#### Reusing large fixtures (dev only)

Opt-in file cache for **large libsqlStore and denokvStore** preload
(`BENCH_REUSE_DB=1`). The first run imports into `benchmarks/.cache/perf-large/`
(`libsqlStore-{n}.db` or `denokvStore-{n}/`); later runs open cached storage and
skip import when the manifest checksum matches (corpus version, backend schema
version, quad count, quads-only import). `Deno.bench` still measures `execute()`
only.

```bash
# shell or .env
BENCH_REUSE_DB=1
deno task bench:sparql-perf-large-libsql:reuse
deno task bench:sparql-perf-large-denokv:reuse
```

Published baselines in the table below use default `:memory:` unless labeled
**file cache**. File-backed execute can differ slightly from `:memory:` (OS page
cache). Invalidate cache: delete `benchmarks/.cache/perf-large/` or bump
`SYNTHETIC_CORPUS_VERSION`, `BENCH_LIBSQL_SCHEMA_VERSION`, or
`BENCH_DENOKV_HEXASTORE_SCHEMA_VERSION` in
[`shared/perf-db-cache.ts`](shared/perf-db-cache.ts) and
[`shared/synthetic-data.ts`](shared/synthetic-data.ts). Override directory:
`BENCH_DB_CACHE_DIR`.

## Measurement notes

Benchmarks preload datasets and SPARQL engines at **module load**; only the hot
path runs inside `benchContext.start()` / `end()`. Write-pressure benches still
create a fresh database per iteration and use `warmup: 5`, `n: 50`.

- **avg** is the primary signal; compare like-for-like OS and Deno versions
  only.
- Large **p99** gaps vs **avg** on older runs usually meant per-iteration import
  and GC between timed slices, not multi-second SPARQL alone. After preload,
  quad index perf p99 should stay within a few× of avg.
- Optional GC trace (local only):

  ```bash
  deno bench --allow-all --v8-flags=--trace-gc benchmarks/sparql-perf-libsql.bench.ts
  ```

**Production (millions of quads):** default to
[`createLibsqlClient`](../src/libsql/create-libsql-client.ts) for hybrid search
and faster preload; consider `createDenokvClient` only when benchmark tradeoffs
match your deployment (warm graph, selective SPARQL). Track guidance in
[#68](https://github.com/wazootech/worlds-client-ts/issues/68).

Baselines in the **pre-preload** table (below) are **not** directly comparable
to **post-preload** captures.

## Baseline table (2026-05-21, pre-preload)

Captured on **Deno 2.7.14 (Windows x86_64)** before module-level preload.
Historical reference only.

### `libsql-pressure.bench.ts`

| Benchmark                                      | Avg                       |
| :--------------------------------------------- | :------------------------ |
| Import 10 / 100 / 1000 quads                   | 4.9 ms / 57.3 ms / 613 ms |
| Full graph export 100 / 1k / 5k¹               | 3.1 ms / 12.6 ms / 152 ms |
| FTS search (2k corpus) specific / multi / miss | 2.1 ms / 10.0 ms / 1.9 ms |

### `denokv-pressure.bench.ts`

| Benchmark                           | Avg                       |
| :---------------------------------- | :------------------------ |
| Import 10 / 100 / 1000              | 419 µs / 1.9 ms / 18.9 ms |
| Full graph export 100 / 1k / 5k¹    | 1.1 ms / 9.0 ms / 49.0 ms |
| Search hit / miss (full 2k KV scan) | 21.7 ms / 20.8 ms         |

### `search-comparison.bench.ts` (LibSQL FTS vs RDF/JS naive)

| Scale | RDF/JS specific | LibSQL FTS specific |
| :---- | :-------------- | :------------------ |
| 100   | 273 µs          | 329 µs              |
| 1k    | 3.1 ms          | 327 µs              |
| 10k   | 18.3 ms         | 300 µs              |

## Baseline table (post-preload, 2026-05-22)

Captured on **Deno 2.8.0 (Windows x86_64)** with module-level preload. Use this
table for local regression checks. ¹Legacy bench rows labeled “Hydration”
measure `client.export()` full-graph reads, not N3 hydration; `denokv-pressure`
now uses the `FullGraphExport` group name.

### `libsql-pressure.bench.ts`

| Benchmark                                      | Avg                        |
| :--------------------------------------------- | :------------------------- |
| Import 10 / 100 / 1000 quads                   | 4.3 ms / 60.5 ms / 615 ms  |
| Full graph export 100 / 1k / 5k¹               | 1.4 ms / 14.1 ms / 73.0 ms |
| FTS search (2k corpus) specific / multi / miss | 997 µs / 7.3 ms / 948 µs   |

### `denokv-pressure.bench.ts`

| Benchmark                           | Avg                        |
| :---------------------------------- | :------------------------- |
| Import 10 / 100 / 1000              | 734 µs / 3.3 ms / 24.7 ms  |
| Full graph export 100 / 1k / 5k¹    | 1.4 ms / 11.9 ms / 58.1 ms |
| Search hit / miss (full 2k KV scan) | 24.0 ms / 25.8 ms          |

### `search-comparison.bench.ts` (LibSQL FTS vs RDF/JS naive)

| Scale | RDF/JS specific | LibSQL FTS specific |
| :---- | :-------------- | :------------------ |
| 100   | 151 µs          | 199 µs              |
| 1k    | 2.0 ms          | 287 µs              |
| 10k   | 13.0 ms         | 182 µs              |

### Standard quad index perf (libsql vs denokv, selective)

Captured **2026-05-27** on **Deno 2.8.0 (Windows x86_64)**. Preload is untimed
(`console.time` at module load); execute is `Deno.bench` avg only. Paste updates
into
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69) —
draft in [`discussion-69-perf-draft.md`](discussion-69-quad
index-perf-draft.md).

**Preload** (`searchIndexOnImport: "disabled"` on LibSQL; kv-toolbox
`batchedAtomic()` on Denokv):

| Quads  | libsqlStore | denokvStore |
| :----- | :---------- | :---------- |
| 1 000  | 139 ms      | 367 ms      |
| 5 000  | 584 ms      | 5.6 s       |
| 10 000 | 874 ms      | 16.3 s      |
| 25 000 | 2.2 s       | 101 s       |
| 50 000 | 4.4 s       | 229 s       |

**Time to first useful SPARQL query:** The execute table is post-preload only.
Import/preload dominates cold start — LibSQL is much faster at scale (e.g. 50k
quads: 4.4 s vs 229 s). For end-to-end time to first useful SPARQL query,
**LibSQL wins** unless Denokv reuses an on-disk fixture (`BENCH_REUSE_DB=1`,
e.g. `deno task bench:sparql-perf-large-denokv:reuse`) or a long-lived process
that already imported the corpus.

**Execute** (selective — `SELECT ?p ?o WHERE { <urn:entity:0> ?p ?o }`):

| Quads  | libsqlStore | denokvStore |
| :----- | :---------- | :---------- |
| 1 000  | 2.9 ms      | 12.4 ms     |
| 5 000  | 4.8 ms      | 5.3 ms      |
| 10 000 | 8.1 ms      | 3.3 ms      |
| 25 000 | 19.2 ms     | 4.0 ms      |
| 50 000 | 32.7 ms     | 5.2 ms      |

**Memory:** not measured by `deno bench`. For peak working set during preload,
watch the process in Task Manager (Windows) or use OS tooling
(`/usr/bin/time -v` on Linux) in a one-off run — expect Denokv `:memory:` to
hold more keys per quad (seven index families) than LibSQL quad index for the
same corpus.

Historical **hydrate+N3** rows (pre-quad index-only preload) are not comparable
to the table above; see
[discussion #45](https://github.com/wazootech/worlds-client-ts/discussions/45).

### `sparql-perf-libsql.bench.ts` (execute only, preloaded)

Registers **selective** benches by default. See standard quad index perf table
above.

### `sparql-perf-denokv.bench.ts` (execute only, preloaded)

Same harness as LibSQL; requires `--unstable-kv`. See standard quad index perf
table above.

### `sparql-perf-large-libsql.bench.ts` (execute only, preloaded)

Captured on **Deno 2.8.0 (Windows x86_64)** via
`deno task bench:sparql-perf-large-libsql`
(`--v8-flags=--max-old-space-size=8192`). **libsqlStore only**,
`searchIndexOnImport: "disabled"` (quads-only preload; no hydrate+N3, no
FTS/chunk build during import).

Module preload (`console.time`, not in `Deno.bench`): 100k ~4.6 s; 250k ~14 s;
500k ~28 s; 1M ~66 s (single libsqlStore fixture per scale; `:memory:` import
after PR #87 batched quad INSERTs, Deno 2.8.0 Windows). Earlier ~20 / 63 / 130 /
279 s rows predated batched INSERTs — see
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69#discussioncomment-17033118).

| Quads   | Query shape | Backend     | Avg     |
| :------ | :---------- | :---------- | :------ |
| 100000  | selective   | libsqlStore | 38.2 ms |
| 100000  | fullScan    | libsqlStore | 232 ms  |
| 250000  | selective   | libsqlStore | 101 ms  |
| 250000  | fullScan    | libsqlStore | 539 ms  |
| 500000  | selective   | libsqlStore | 179 ms  |
| 500000  | fullScan    | libsqlStore | 1.1 s   |
| 1000000 | selective   | libsqlStore | 373 ms  |
| 1000000 | fullScan    | libsqlStore | 2.2 s   |

Earlier captures (2026-05-22) included hydrate+N3 and inline search indexing;
preload ~33–39 s/backend at 100k through ~466–509 s/backend at 1M — not
comparable to the row above.

## Regression policy

- Investigate when a keyed benchmark regresses by **more than ~15%** average vs
  the post-preload table on the same OS and Deno version.
- Open a **new issue** with pasted before/after `deno bench` output.
- Link
  [discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69)
  when SPARQL quad index perf numbers change.

```bash
deno task bench
```

## SPARQL quad index perf results template

Paste into
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69)
or release notes:

| Quads   | Query shape | Backend     | Avg     |
| :------ | :---------- | :---------- | :------ |
| 1000    | selective   | hydrate+N3  |         |
| 1000    | selective   | libsqlStore | 2.9 ms  |
| 1000    | selective   | denokvStore | 12.4 ms |
| 5000    | selective   | libsqlStore | 4.8 ms  |
| 5000    | selective   | denokvStore | 5.3 ms  |
| …       | …           | …           |         |
| 100000  | selective   | libsqlStore |         |
| 1000000 | selective   | libsqlStore |         |
| …       | …           | …           |         |
