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

- **Portable facade** — Unified `Client` API that works across in-memory,
  LibSQL/Turso, and Deno KV backends.
- **Search** — Hybrid retrieval combining keyword FTS5 and vector embeddings.
- **Query** — Built-in SPARQL engine for declarative graph traversal and
  reasoning.
- **In-memory RDF/JS** — Zero-setup N3-based graph store and search for dev,
  tests, and demos.

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

> [!TIP]
> For production search and scale, use the durable LibSQL (`@worlds/libsql`) or
> Deno KV (`@worlds/denokv`) backends.

## Core concepts

**Quad store**: Manages RDF triples (subject, predicate, object, graph) with
transactional import and export.

**Search index**: Hybrid retrieval over graph literals, combining keyword FTS5
with vector similarity via an embedding service and quad chunker.

**SPARQL engine**: Evaluates declarative queries and updates against the graph
for structured traversal and reasoning.

## Module layout

`Client` is the portable facade. Shared modules sit under `src/client/`:

| Export                         | Role                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `@worlds/client`               | Root barrel: `Client`, interfaces, patch types       |
| `@worlds/client/quad-store`    | Quad import/export API, RDF formats, patch buffering |
| `@worlds/client/search-index`  | Search index interface and types                     |
| `@worlds/client/sparql-engine` | SPARQL engine interface                              |
| `@worlds/client/rdfjs`         | In-memory N3 `RdfjsQuadStore` and `RdfjsSearchIndex` |
| `@worlds/client/comunica`      | `ComunicaSparqlEngine` adapter                       |
| `@worlds/client/ai-sdk`        | Vercel AI SDK tool bindings                          |

Regenerate merged API doc JSON with `deno task doc:json` (writes gitignored
`docs/api.json`). For architecture documentation (package topology, runtime
model), see [ARCHITECTURE.md](ARCHITECTURE.md). For agent coding rules and
conventions, see [AGENTS.md](AGENTS.md).

## Adapters

This package provides the core in-memory RDF/JS backend. Durable backends live
in separate packages:

| Package                                                        | Persistence          | Search               | SPARQL                        |
| -------------------------------------------------------------- | -------------------- | -------------------- | ----------------------------- |
| `@worlds/client` (this package)                                | In-memory (N3 Store) | RDF/JS keyword       | Comunica over N3 Store        |
| [`@worlds/libsql`](https://github.com/wazootech/worlds-libsql) | SQLite / Turso Cloud | Hybrid FTS5 + vector | LibsqlRdfjsStore quad indexes |
| [`@worlds/denokv`](https://github.com/wazootech/worlds-denokv) | Deno KV              | Keyword FTS          | DenokvRdfjsStore quad indexes |

**Choosing LibSQL vs Deno KV:** LibSQL is the default for hybrid FTS/vector
search and faster cold quad index preload at scale. Deno KV can be faster on
selective SPARQL execute after preload in long-lived or cached processes. See
[discussion #69](https://github.com/wazootech/worlds-client-ts/discussions/69)
for benchmark methodology.

### In-memory (dev, tests, demos)

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

## Examples

| Example     | Description                     | Command                                |
| ----------- | ------------------------------- | -------------------------------------- |
| Hello world | In-memory graph with search     | `deno task example:hello-world`        |
| AI SDK      | Vercel AI SDK tools with Gemini | `deno task example:ai-sdk-hello-world` |

For LibSQL or Deno KV examples, see the
[`@worlds/libsql`](https://github.com/wazootech/worlds-libsql) and
[`@worlds/denokv`](https://github.com/wazootech/worlds-denokv) repositories.

The [agent eval harness](https://github.com/wazootech/worlds-client-evals) lives
in a separate repository and runs deterministic assertion checks against a
seeded LibSQL world.

## Advanced

**Agent integration**: search-then-SPARQL two-hop pattern for LLM tool use with
hybrid retrieval. See [AGENTS.md](AGENTS.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

**LibSQL/Deno KV benchmarks**: Quad index performance methodology, regression
policy, and comparison tables live in the adapter repos
([`@worlds/libsql`](https://github.com/wazootech/worlds-libsql),
[`@worlds/denokv`](https://github.com/wazootech/worlds-denokv)).

## Development workflow

All CI checks must pass before merging updates.

| Command          | Description                                  |
| ---------------- | -------------------------------------------- |
| `deno fmt`       | Format all code using native Deno formatter. |
| `deno task lint` | Run strict static analysis checks.           |
| `deno task test` | Execute comprehensive test suites.           |
| `deno task ci`   | Run complete CI pipeline sequentially.       |

## Quicklinks

- [Documentation](https://docs.wazoo.dev)
- [Wazoo Technologies](https://wazoo.dev)
- [Support](https://github.com/wazootech/worlds-client-ts/issues)

Developed with [**@wazootech**](https://github.com/wazootech)
