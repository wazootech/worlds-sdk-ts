<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Persistent, edge-native knowledge graph storage for agents.</em>
  <br /><br />
  <a href="https://jsr.io/@worlds/client"><img src="https://jsr.io/badges/@worlds/client" alt="JSR" /></a>
  <a href="https://jsr.io/@worlds/client/score"><img src="https://jsr.io/badges/@worlds/client/score" alt="JSR Score" /></a>
  <a href="https://github.com/wazootech/worlds-client-ts"><img src="https://img.shields.io/badge/GitHub-black?logo=github" alt="GitHub" /></a>
  <a href="https://deepwiki.com/wazootech/worlds-client-ts"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
</p>

- **Store** — Persist RDF knowledge graphs on SQLite, Turso, or Deno KV.
- **Search** — Hybrid retrieval combining keyword FTS5 and vector embeddings.
- **Query** — Built-in SPARQL engine for declarative graph traversal and
  reasoning.
- **Sync** — Transactional mutation queue with dual-layer persistence.

## Install

```bash
deno add jsr:@worlds/client
```

## Quickstart

```typescript
import { Client } from "@worlds/client";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";

const store = new Store();
const client = new Client({
  quadStore: new RdfjsQuadStore(store),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new ComunicaSparqlEngine({
    queryEngine: new QueryEngine(),
    store,
  }),
});

await client.import({
  source: {
    kind: "serialized",
    contentType: "text/turtle",
    data: `@prefix ex: <http://example.org/> .
      ex:Alice ex:bio "Alice explores the depths." ;
               ex:location "Underdark" .`,
  },
});

const searchResults = await client.search({ query: "explores" });
const subject = searchResults.results[0].subject;

const sparqlResponse = await client.sparql({
  query: `SELECT ?property ?object WHERE { <${subject}> ?property ?object }`,
});
console.log(sparqlResponse);
```

> \[!TIP\] For production search and scale, use LibSQL with Turso Cloud. Deno KV
> can win on selective post-preload SPARQL in warm Deno deployments — see
> [Adapters](#adapters) and benchmarks.

## Core concepts

**Quad store**: Manages RDF triples (subject, predicate, object, graph) with
transactional import and export.

**Search index**: Hybrid retrieval over graph literals, combining keyword FTS5
with vector similarity via an embedding service and quad chunker.

**SPARQL engine**: Evaluates declarative queries and updates against the graph
for structured traversal and reasoning.

## Module layout

`Client` is the portable facade; durable backends assemble it via
`createLibsqlClient` or `createDenokvClient`. Shared modules sit under
`src/client/`:

| Module             | Export                         | Role                                                        |
| ------------------ | ------------------------------ | ----------------------------------------------------------- |
| `quad-store`       | `@worlds/client/quad-store`    | Import/export API, patch types, RDF formats                 |
| `rdfjs-buffer`     | `@worlds/client/quad-store`    | Shared patch buffering and import flush (topology-agnostic) |
| `import-lifecycle` | `@worlds/client` (root barrel) | Import lifecycle hooks around durable commits               |
| `*/rdfjs-store`    | `@worlds/client/libsql` (etc.) | Durable `*RdfjsStore` quad index + backend sync             |

Do not confuse `@worlds/client/quad-store` with backend `rdfjs-store/` folders —
they are different layers. Durable import flow: `Client.import` → `*QuadStore` →
`importViaBufferedRdfjsStore` → `*RdfjsStore.commit` → backend `commitPatchTo*`.

Regenerate merged API doc JSON with `deno task doc:json` (writes gitignored
`file docs/api.json`). Agent prompts, scale guidance, and coding rules:
[AGENTS.md](AGENTS.md).

## Adapters

| Adapter               | Best for                                  | Persistence          | SPARQL                        |
| --------------------- | ----------------------------------------- | -------------------- | ----------------------------- |
| RDF/JS (in-memory N3) | Dev, tests, demos                         | None (in-memory)     | Comunica over N3 `Store`      |
| LibSQL                | Production default (search + bulk load)   | SQLite / Turso Cloud | LibsqlRdfjsStore quad indexes |
| Deno KV               | Deno-native, warm graph, selective SPARQL | Deno KV store        | DenokvRdfjsStore quad indexes |

**Choosing LibSQL vs Deno KV:** LibSQL is the default for hybrid FTS/vector
search and faster cold quad index preload at scale. Deno KV can be faster on
selective SPARQL execute after preload in long-lived or cached processes —
compare backends in benchmarks/README.md and
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69).

### RDF/JS (in-memory N3)

```typescript
import { Client } from "@worlds/client";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";

const store = new Store();
const client = new Client({
  quadStore: new RdfjsQuadStore(store),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new ComunicaSparqlEngine({
    queryEngine: new QueryEngine(),
    store,
  }),
});
```

### LibSQL (production default)

```typescript
import { createLibsqlClient } from "@worlds/client/libsql";
import { createClient } from "@libsql/client";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";

const db = createClient({ url: "file:./worlds.db" });
const client = await createLibsqlClient({
  client: db,
  queryEngine: new QueryEngine(),
});
```

### Deno KV (Deno-native durable)

```typescript
import { createDenokvClient } from "@worlds/client/denokv";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";

const kv = await Deno.openKv();
const client = createDenokvClient({
  kv,
  queryEngine: new QueryEngine(),
});
```

## Examples

| Example     | Description                            | Command                                |
| ----------- | -------------------------------------- | -------------------------------------- |
| Hello world | In-memory graph with search            | `deno task example:hello-world`        |
| LibSQL      | LibSQL hybrid search + SPARQL at scale | `deno task example:libsql-hello-world` |
| Deno KV     | KV-backed SPARQL + search              | `deno task example:denokv-hello-world` |
| AI SDK      | Vercel AI SDK tools with Gemini        | `deno task example:ai-sdk-hello-world` |

The [agent eval harness](https://github.com/wazootech/worlds-client-evals) lives
in a separate repository and runs deterministic assertion checks against a
seeded LibSQL world.

## Advanced

**Choosing a LibSQL topology**: quad index default (historical N3 hydrate path
removed; in-memory N3 via RDF/JS adapter), warm containers, SPARQL query shape
at scale, and bulk import strategies. [-&gt; AGENTS.md](AGENTS.md)

**Agent integration**: search-then-SPARQL two-hop pattern for LLM tool use with
hybrid retrieval. [-&gt; AGENTS.md](AGENTS.md)

**Benchmarks**: local-only performance captures, quad index perf methodology
(LibSQL + Denokv), and regression policy. -&gt; benchmarks/README.md

## Development workflow

All CI checks must pass before merging updates. Performance benchmarks are
**local only** (no CI regression gate); see `file benchmarks/README.md`.

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `deno fmt`        | Format all code using native Deno formatter. |
| `deno task lint`  | Run strict static analysis checks.           |
| `deno task test`  | Execute comprehensive test suites.           |
| `deno task bench` | Run performance benchmarks locally.          |
| `deno task ci`    | Run complete CI pipeline sequentially.       |

## Quicklinks

- [Documentation](https://docs.wazoo.dev)
- [Wazoo Technologies](https://wazoo.dev)
- [Support](https://github.com/wazootech/worlds-client-ts/issues)

Developed with [**@wazootech**](https://github.com/wazootech)
