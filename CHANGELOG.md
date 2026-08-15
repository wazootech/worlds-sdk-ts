# Changelog

## 0.0.19

### Changed

- Default the in-memory SPARQL engine to `@wazoo/sparql-engine`
  (`WazooSparqlEngine`), keeping Comunica as the compatible alternative via
  `@worlds/client/comunica`.
- Reconcile `SparqlEngineInterface` with `@wazoo/sparql-engine` under the
  identical-spec policy: add the `construct` result variant and RDF 1.2
  `its:dir` literal direction, and collapse `SparqlRequest.query`/`update` into
  a single required `query` field.

## Unreleased

### Breaking

- Removed exported `Adapter`. **`ClientInterface`** is the public contract;
  **`Client`** is the exported class
  (`new Client({ quadStore, searchIndex,
  sparqlEngine? })`). Durable backends:
  `createLibsqlClient`, `createDenokvClient`. **Removed `createRdfjsClient`** —
  wire in-memory N3 with `RdfjsQuadStore` / `RdfjsSearchIndex` explicitly.
- Renamed `createLibsqlAdapter` → `createLibsqlClient` (and matching
  `LibsqlClientOptions`). Same pattern for RDF/JS and Deno KV.
- Removed `createLibsqlClientFromStores`, `createLibsqlClientInfrastructure`,
  `createLibsqlStores`, `createDenokvClientFromStores`, and
  `createDenokvStores`. Custom assembly uses explicit
  `new Client({ quadStore, searchIndex, sparqlEngine? })`.
- Narrowed `@worlds/client/adapters/libsql` and `@worlds/client/adapters/denokv`
  exports to factory entry points, suffixed stores, and search helpers; SQL/KV
  internals are in-repo only under durable adapter seam folders such as
  `libsql/rdfjs-store/sql/` and `denokv/rdfjs-store/kv/`.
- Renamed `rebuildSearchIndex` → **`reindex`**; `RebuildSearchIndexRequest` /
  `RebuildSearchIndexResponse` → `ReindexRequest` / `ReindexResponse`. RDF/JS
  and Deno KV `reindex()` succeed as documented no-ops.
- **`ImportLifecycle`** (`beforeImport` / `afterImport`) runs on import commits
  via `commitBufferedPatch` when `PatchCommitContext.importMode` is set. Durable
  factories wire flat `beforeImport` / `afterImport` onto `*RdfjsStore` (not
  `*QuadStore`). Import and SPARQL UPDATE both buffer patches through `commit()`
  → `commitBufferedPatch` → `commitPatchTo*`. Replace import: LibSQL wipes
  `quads`/`chunks` in `commitPatchToLibsql`; Deno KV generation-swap in
  `commitPatchToDenokv`. `createLibsqlPersistHooks` and
  `createDenokvPersistHooks` return
  `{ commitHandler, beforeImport, afterImport
  }` and map `searchIndexOnImport`
  for projection and deferred reindex.
- Renamed **`commit-sync`** → **`import-lifecycle`** (root barrel export).
  Removed **`CommitSyncState`**; use flat `commitHandler` and optional
  `importLifecycle` on `*RdfjsStore`.
- Renamed **`createLibsqlCommitSync`** → **`createLibsqlPersistHooks`**;
  **`createDenokvCommitSync`** → **`createDenokvPersistHooks`**.
- Renamed **`BufferedRdfjsPatchState`** → **`RdfjsPatchBuffer`**;
  **`flushCommit`** → **`flushBuffer`**; **`deduplicatePatchBuffers`** →
  **`deduplicateBuffers`**; **`CommittingRdfjsStore`** →
  **`ImportCommitTarget`**; **`createRdfjsCommittingStore`** →
  **`createImportCommitTarget`**.
- Renamed `@worlds/client/rdfjs-store` → **`@worlds/client/quad-store`** (shared
  patch buffering and import orchestration). Adapter `*RdfjsStore`
  implementations remain under `@worlds/client/adapters/*/rdfjs-store/`.
- Removed dead `wire-durable-client.ts` stub (logic lives in durable factories).

### Migration

```typescript
// Before
import { Client } from "@worlds/client";
import { createLibsqlAdapter } from "@worlds/client/adapters/libsql";
const client = new Client(
  await createLibsqlAdapter({ client: db, queryEngine }),
);
await client.rebuildSearchIndex();

// After
import { createLibsqlClient } from "@worlds/client/adapters/libsql";
const client = await createLibsqlClient({ client: db, queryEngine });
await client.reindex();

// Shared buffering (was @worlds/client/rdfjs-store)
import { importViaBufferedRdfjsStore } from "@worlds/client/quad-store";

// In-memory (replaces createRdfjsClient)
import { Client } from "@worlds/client";
import {
  RdfjsQuadStore,
  RdfjsSearchIndex,
} from "@worlds/client/adapters/rdfjs";
import { ComunicaSparqlEngine } from "@worlds/client/adapters/comunica";
import { Store } from "n3";

const store = new Store();
const memoryClient = new Client({
  quadStore: new RdfjsQuadStore(store),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new ComunicaSparqlEngine({ queryEngine, store }),
});
```

### Changed

- Removed misnamed LibSQL query helpers `buildHydrateQuery` and
  `buildHydrateQuadsPageQuery` from `LibsqlQueryBuilder` (not exported from
  `@worlds/client/adapters/libsql`; breaking only for deep imports of
  `libsql-query-builder.ts`). `rebuildLibsqlSearchIndexFromQuads` now
  keyset-pages via `buildMatchQuadsQuery` with `filterQuads` in TypeScript for
  include/exclude.
- Durable `LibsqlQuadStore` and `DenokvQuadStore` extend shared
  `BufferedRdfjsQuadStore` (`@worlds/client/quad-store`), delegating import and
  export to `importViaBufferedRdfjsStore` / `exportFromRdfjsStore`.
- LibSQL SPARQL is configured by passing a Comunica `queryEngine` directly into
  adapter options (no `createSparqlEngine` callback or factory helper).
- Deno KV SPARQL reads through a KV-backed RDF/JS store (no per-query N3
  hydration).
- Deno KV `import({ mode: "replace" })` uses an atomic dataset-generation
  pointer instead of prefix-wide deletes; `match()`, `export`, and search scan
  the active generation only.
- Deno KV quad index `match()` routing is covered by LibSQL-aligned integration
  tests (predicate-, object-, and graph-first patterns).
- Deno KV `replace` garbage-collects orphaned generation keys, adds `idx_sopg`
  (subject+object) index family, and exposes `countQuads` on `DenokvRdfjsStore`
  for Comunica cardinality hints.
- Deno KV quad index defaults to **seven** quad-native index families (`psog`,
  `opsg` added for full S-P-O-G coverage); re-import or `replace` to backfill
  index keys on existing KV data.

### Breaking

- Removed `@worlds/client/adapters/libsql-n3` (`createLibsqlN3Adapter`) and
  `@worlds/client/quad-store/n3` (`createProxiedN3Store`).
- Removed `createComunicaSparqlEngineFactory` and `createSparqlEngine` adapter
  callbacks; pass `queryEngine` into adapter options instead.
- Renamed `LibsqlStore` / `LibsqlStoreOptions` to `LibsqlRdfjsStore` /
  `LibsqlRdfjsStoreOptions`. LibSQL `client.import` / `export` now go through
  `LibsqlQuadStore` instead of generic `RdfjsQuadStore`.
- Removed `createLibsqlClientFromRdfjsStore`; use
  `createLibsqlClientFromStores`.
- Added `createDenokvClientFromStores` for Deno KV adapter assembly.
- Organized durable adapter internals into seam folders such as `rdfjs-store/`,
  `quad-store/`, and `search-index/`.

### Migration

```typescript
// Before
import { ComunicaSparqlEngine } from "@worlds/client/adapters/comunica";

createSparqlEngine: ({ store }) =>
  new ComunicaSparqlEngine({ queryEngine, store }),

// After
queryEngine,
```

```typescript
// Before
import { LibsqlStore } from "@worlds/client/adapters/libsql";

// After
import {
  LibsqlQuadStore,
  LibsqlRdfjsStore,
} from "@worlds/client/adapters/libsql";
```

Most apps keep using `createLibsqlClient` unchanged:

```typescript
import { createLibsqlClient } from "@worlds/client/adapters/libsql";

const adapter = await createLibsqlClient({ client, queryEngine });
```

Custom LibSQL assembly (removed `createLibsqlClientFromStores` and
`createLibsqlClientInfrastructure`; prefer `createLibsqlClient` when possible):

```typescript
import { Client } from "@worlds/client";
import { ComunicaSparqlEngine } from "@worlds/client/adapters/comunica";
import {
  createLibsqlClient,
  LibsqlQuadStore,
  LibsqlRdfjsStore,
  LibsqlSearchIndex,
} from "@worlds/client/adapters/libsql";

// Default path (recommended):
const adapter = await createLibsqlClient({ client, queryEngine });

// Advanced warm-start: mirror create-libsql-client.ts wiring, then:
const customAdapter = new Client({
  quadStore: libsqlQuadStore,
  searchIndex: libsqlSearchIndex,
  sparqlEngine: new ComunicaSparqlEngine({
    queryEngine,
    store: libsqlRdfjsStore,
  }),
});
```

If you wrapped `LibsqlStore` with `RdfjsQuadStore` for `client.import`:

```typescript
// Before
new RdfjsQuadStore({ rdfjsStore: libsqlStore, importLifecycle });

// After
new LibsqlQuadStore({ libsqlRdfjsStore, importLifecycle });
```

Deno KV custom assembly (removed `createDenokvClientFromStores`; prefer
`createDenokvClient` when possible):

```typescript
import { Client } from "@worlds/client";
import {
  createDenokvClient,
  DenokvQuadStore,
  DenokvRdfjsStore,
  DenokvSearchIndex,
} from "@worlds/client/adapters/denokv";

const adapter = createDenokvClient({ kv, keyPrefix, queryEngine });

// Advanced: mirror create-denokv-client.ts, then pass stores to Client.
const customAdapter = new Client({
  quadStore: denokvQuadStore,
  searchIndex: new DenokvSearchIndex({ kv, keyPrefix }),
  sparqlEngine,
});
```

Shared import helpers (`getFormat`, `parseQuads`, `materializeImportQuads`) are
exported from `@worlds/client/quad-store` (no new export subpath).

## 0.0.15

### Breaking

- Removed `@worlds/client/adapters/libsql/n3`. Use
  `@worlds/client/adapters/libsql-n3` (`createLibsqlN3Adapter`).
- Removed `@worlds/client/adapters/rdfjs/n3`. N3 patch capture moved to
  `@worlds/client/quad-store/n3` as `createProxiedN3Store` (formerly
  `proxyStore` on the old path).
- Removed libsql SPARQL query-pattern helper exports; use inline SPARQL strings
  in application code.
- Renamed `ClientOptions` to `Adapter`. The interface describes the composed
  adapter bridging platform-specific infrastructure to the generic `Client`, not
  passive configuration.
- Renamed all adapter factory functions to match:
  - `createRdfjsClientOptions` -> `createRdfjsClient`
  - `createLibsqlClientOptions` -> `createLibsqlClient`
  - `createLibsqlN3ClientOptions` -> `createLibsqlN3Adapter`
  - `createDenokvClientOptions` -> `createDenokvClient`
- Factory source files renamed for file-symbol alignment (e.g.
  `create-libsql-client.ts` -> `create-libsql-client.ts`).

### Added

- `mergePatches` on `@worlds/client/quad-store` for concatenating drained N3
  patch batches before persistence.
- `@worlds/client/quad-store/n3` (`createProxiedN3Store`).

### Migration

```typescript
// Before
import { createLibsqlN3Adapter } from "@worlds/client/adapters/libsql/n3";

// After
import { createLibsqlN3Adapter } from "@worlds/client/adapters/libsql-n3";
```

```typescript
// Before
const client = new Client(await createLibsqlClientOptions({ client: db }));

// After
const client = new Client(await createLibsqlClient({ client: db }));
```

```typescript
// Before
import { proxyStore } from "@worlds/client/adapters/rdfjs/n3";

// After
import { createProxiedN3Store } from "@worlds/client/quad-store/n3";
import { mergePatches } from "@worlds/client/quad-store";

const { store, drainPatches } = createProxiedN3Store(baseStore);
const patch = mergePatches(drainPatches());
```

## 0.0.14

### Added

- `createComunicaSparqlEngineFactory` and
  `createComunicaLibsqlSparqlEngineFactory` on
  `@worlds/client/adapters/comunica` — preset helpers that return typed
  `createSparqlEngine` callbacks for standard Comunica wiring.

## 0.0.13

### Breaking

- Removed `createLibsqlClient`, `createLibsqlN3Client`, `createRdfjsClient`, and
  `createDenokvClient`. Use `new Client(await createXClientOptions(...))` (or
  `new Client(createXClientOptions(...))` when synchronous).

### Migration

```typescript
// Before
const client = await createLibsqlClient({ client: db });

// After
import { Client } from "@worlds/client";
const client = new Client(await createLibsqlClientOptions({ client: db }));
```

### Examples

- Merged `examples/libsql-hello-world` into
  `examples/libsql-long-running/quad index.ts`.
- Split LibSQL deployment examples into `libsql-long-running` and
  `libsql-n3-warm-container`, each with `quad index.ts` and `n3.ts`.
