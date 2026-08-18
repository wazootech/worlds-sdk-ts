<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Persistent, edge-native knowledge graph storage for agents.</em>
  <br /><br />
  <a href="https://jsr.io/@worlds/sdk"><img src="https://jsr.io/badges/@worlds/sdk" alt="JSR" /></a>
  <a href="https://jsr.io/@worlds/sdk/score"><img src="https://jsr.io/badges/@worlds/sdk/score" alt="JSR Score" /></a>
  <a href="https://github.com/wazootech/worlds-sdk-ts"><img src="https://img.shields.io/badge/GitHub-black?logo=github" alt="GitHub" /></a>
  <a href="https://deepwiki.com/wazootech/worlds-sdk-ts"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
</p>

- **Portable facade** — Unified `Sdk` API that works across in-memory,
  LibSQL/Turso, and Deno KV backends.
- **Search** — Hybrid retrieval combining keyword FTS5 and vector embeddings.
- **Query** — The zero-dependency Wazoo SPARQL engine as the opinionated minimal
  default.
- **In-memory RDF/JS** — Zero-setup, zero-dependency graph store and search (the
  engine's `MemoryStore`) for dev, tests, and demos.

## Install

```bash
deno add jsr:@worlds/sdk
```

## Quickstart

```typescript
import { Sdk } from "@worlds/sdk";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";

const store = new MemoryStore();
const client = new Sdk({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new WazooSparqlEngine({ store }),
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
for structured traversal and reasoning, powered by the zero-dependency
[`@wazoo/sparql-engine`](https://jsr.io/@wazoo/sparql-engine).

## Module layout

`Sdk` is the portable facade. Shared modules sit under `src/client/`:

| Export                      | Role                                                 |
| --------------------------- | ---------------------------------------------------- |
| `@worlds/sdk`               | Root barrel: `Sdk`, interfaces, patch types          |
| `@worlds/sdk/quad-store`    | Quad import/export API, RDF formats, patch buffering |
| `@worlds/sdk/search-index`  | Search index interface and types                     |
| `@worlds/sdk/sparql-engine` | SPARQL engine interface                              |
| `@worlds/sdk/rdfjs`         | In-memory `RdfjsQuadStore` and `RdfjsSearchIndex`    |
| `@worlds/sdk/ai-sdk`        | Vercel AI SDK tool bindings                          |

The SPARQL engine is the external
[`@wazoo/sparql-engine`](https://jsr.io/@wazoo/sparql-engine) package, which
implements `SparqlEngineInterface`.

Regenerate merged API doc JSON with `deno task doc:json` (writes gitignored
`docs/api.json`). For architecture documentation (package topology, runtime
model), see [ARCHITECTURE.md](ARCHITECTURE.md). For agent coding rules and
conventions, see [AGENTS.md](AGENTS.md).

## Adapters

This package provides the core in-memory RDF/JS backend. Durable backends live
in separate packages:

| Package                                                        | Persistence               | Search               | SPARQL                        |
| -------------------------------------------------------------- | ------------------------- | -------------------- | ----------------------------- |
| `@worlds/sdk` (this package)                                   | In-memory (`MemoryStore`) | RDF/JS keyword       | Wazoo                         |
| [`@worlds/libsql`](https://github.com/wazootech/worlds-libsql) | SQLite / Turso Cloud      | Hybrid FTS5 + vector | LibsqlRdfjsStore quad indexes |
| [`@worlds/denokv`](https://github.com/wazootech/worlds-denokv) | Deno KV                   | Keyword FTS          | DenokvRdfjsStore quad indexes |

**Choosing LibSQL vs Deno KV:** LibSQL is the default for hybrid FTS/vector
search and faster cold quad index preload at scale. Deno KV can be faster on
selective SPARQL execute after preload in long-lived or cached processes. See
[discussion #69](https://github.com/wazootech/worlds-sdk-ts/discussions/69) for
benchmark methodology.

### In-memory (dev, tests, demos)

```typescript
import { Sdk } from "@worlds/sdk";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";

const store = new MemoryStore();
const client = new Sdk({
  quadStore: new RdfjsQuadStore({ store }),
  searchIndex: new RdfjsSearchIndex(store),
  sparqlEngine: new WazooSparqlEngine({ store }),
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

Agent evaluation and memory benchmarking lives in the separate
[wazoo-memorybench](https://github.com/wazootech/wazoo-memorybench) repository,
successor to the archived worlds-client-evals eval harness.

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
- [Support](https://github.com/wazootech/worlds-sdk-ts/issues)

Developed with [**@wazootech**](https://github.com/wazootech)
