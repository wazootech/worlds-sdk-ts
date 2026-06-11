# Porting guide

This repository is being split into smaller packages.

## What moved

- `src/libsql/` moved to `@worlds/libsql`
- `src/denokv/` moved to `@worlds/denokv`
- `src/rdfjs/` stays in `@worlds/client`
- `src/comunica/` stays in `@worlds/client`
- `src/search-index/quad-chunker/` stays in `@worlds/client`
- `src/search-index/embedding-service/` stays in `@worlds/client` for now

## Update imports

### LibSQL

```typescript
import { createLibsqlClient } from "@worlds/libsql";
import { LibsqlQuadStore } from "@worlds/libsql/quad-store";
import { LibsqlRdfjsStore } from "@worlds/libsql/rdfjs-store";
```

### Deno KV

```typescript
import { createDenokvClient } from "@worlds/denokv";
import { DenokvQuadStore } from "@worlds/denokv/quad-store";
import { DenokvRdfjsStore } from "@worlds/denokv/rdfjs-store";
```

### Core client

```typescript
import { Client } from "@worlds/client";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
```

## What no longer belongs here

- LibSQL and Deno KV adapter code
- their tests
- their hello-world examples
- their benchmark files

## Recommended migration order

1. Move application code to `@worlds/libsql` or `@worlds/denokv`
2. Replace package imports in downstream repos
3. Remove the old adapter code from `@worlds/client`
4. Keep the core graph/query/search layer in `@worlds/client`

