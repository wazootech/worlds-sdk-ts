# Porting guide

This repository is being split into smaller packages. The important part is not just *what* moved, but *where it lives now*.

## Destination repos

| Old home | New home | Status |
| --- | --- | --- |
| `wazootech/worlds-client-ts` | Core client, RDF/JS, Comunica, and search-chunker abstractions | stays here |
| `wazootech/worlds-libsql` | LibSQL persistence + LibSQL search/index logic | created |
| `wazootech/worlds-denokv` | Deno KV persistence + Deno KV search/index logic | created |
| future embedding-provider repos | concrete embedding demos and provider-specific code | pending |

## What stays in `wazootech/worlds-client-ts`

Keep the shared, backend-agnostic layer here:

- `src/rdfjs/` — in-memory `RdfjsQuadStore` / `RdfjsSearchIndex`
- `src/comunica/` — `ComunicaSparqlEngine`
- `src/search-index/quad-chunker/` — chunking logic for derived search rows
- `src/search-index/embedding-service/` — embedding abstraction only
- `src/client/` — `Client`, interfaces, patch types, transactions, helpers

This repo should own the stable API surface that both backend packages depend on.

## What moves to `wazootech/worlds-libsql`

Move the LibSQL-specific implementation here:

- `src/libsql/`
- LibSQL schema setup
- LibSQL quad-store / RDFJS-store implementation
- LibSQL search-index implementation
- LibSQL tests and examples
- LibSQL benchmark code

Import it as:

```typescript
import { createLibsqlClient } from "@worlds/libsql";
```

## What moves to `wazootech/worlds-denokv`

Move the Deno KV-specific implementation here:

- `src/denokv/`
- Deno KV generation and keying logic
- Deno KV quad-store / RDFJS-store implementation
- Deno KV search-index implementation
- Deno KV tests and examples
- Deno KV benchmark code

Import it as:

```typescript
import { createDenokvClient } from "@worlds/denokv";
```

## What leaves into separate embedding repos

The abstraction can stay in `worlds-client-ts`, but provider-specific embedding code should not.

That means:

- keep `EmbeddingService` and other shared interfaces here
- remove concrete provider code such as `ai-sdk` and `tfjs` from this repo
- publish separate repos for embedding demos / provider implementations
- keep those repos focused on generating embeddings, not on graph storage

## Import map after the split

### Core client

```typescript
import { Client } from "@worlds/client";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
```

### LibSQL backend

```typescript
import { createLibsqlClient } from "@worlds/libsql";
```

### Deno KV backend

```typescript
import { createDenokvClient } from "@worlds/denokv";
```

## Migration order

1. Keep the shared core API stable in `wazootech/worlds-client-ts`.
2. Move LibSQL logic into `wazootech/worlds-libsql`.
3. Move Deno KV logic into `wazootech/worlds-denokv`.
4. Split embedding-provider implementations into their own repos.
5. Update downstream repos to import from the new package homes.
6. Delete the old backend-specific code from `worlds-client-ts` once the new repos are the source of truth.

## Rule of thumb

If the code answers "how do we store, index, or query the graph?" it belongs in `worlds-client-ts`, `worlds-libsql`, or `worlds-denokv` depending on backend.

If the code answers "how do we generate embeddings with a specific provider?" it belongs in a dedicated embedding repo, not in this core package.
