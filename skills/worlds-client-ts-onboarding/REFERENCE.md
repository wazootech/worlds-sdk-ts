# Codebase reference and introduction

This document provides a high-level walkthrough of the `@worlds/client`
architecture, listing the key entry points, testing procedures, and the
front-to-back integration plan.

## Architecture overview

The Worlds Client is a unified neurosymbolic runtime facade fusing three main
primitives:

1. **Graph Store**: An RDF hexastore persistence layer (implementing
   `*RdfjsStore` and `*QuadStore`).
2. **Search Index**: A hybrid search index supporting Vector Semantic similarity
   and SQLite FTS5 Keyword search.
3. **SPARQL Engine**: A query evaluator (via Comunica) for graph traversal and
   reasoning.

```mermaid
graph TD
    Client[Client Facade] --> QuadStore[Quad Store Interface]
    Client --> SearchIndex[Search Index Interface]
    Client --> SparqlEngine[SPARQL Engine Interface]
    
    QuadStore --> LibsqlQuadStore[LibSQL / Deno KV Adapters]
    SearchIndex --> HybridSearch[FTS5 + TF.js Embeddings]
    SparqlEngine --> Comunica[Comunica SPARQL Engine]
```

## Files to read first

To understand how the codebase is structured, start by reading these files in
order:

1. **[examples/hello-world/main.ts](../../examples/hello-world/main.ts)**
   - _Why_: The simplest demonstration of the SDK. Sets up an in-memory client
     using standard N3 quad stores, imports turtle data, searches, and queries
     it with SPARQL.
2. **[examples/libsql-hello-world/main.ts](../../examples/libsql-hello-world/main.ts)**
   - _Why_: Demonstrates production configuration using durable LibSQL (SQLite),
     hybrid FTS5 and vector search, and selective, subject-bound SPARQL
     querying.
3. **[src/client/client.ts](../../src/client/client.ts)**
   - _Why_: The primary orchestration layer. It exposes the core SDK methods
     (`import`, `export`, `search`, `sparql`, `reindex`) and delegates them to
     the injected adapters.
4. **[src/client/client.test.ts](../../src/client/client.test.ts)**
   - _Why_: A clean suite of tests showing exactly how the Client interacts with
     quad stores and search indexes in an isolated environment.
5. **[AGENTS.md](../../AGENTS.md)**
   - _Why_: The absolute behavioral source of truth. Contains core glossaries,
     coding standards, naming conventions, import path conventions, and the
     agent prompt contract.

## Tests to run

Before running tests or examples, install dependencies and execute package build
scripts:

```bash
deno install --allow-scripts
```

To verify the local installation, run:

```bash
# Run all tests (including Deno KV and SQLite tests)
deno task test

# Run only the core client test suite
deno test --allow-all --unstable-kv src/client/client.test.ts
```

## Ecosystem integration and peripherals

The ultimate goal of mastering the client SDK is to build new full-stack
projects and peripherals on top of the worlds ecosystem.

### Ecosystem peripherals and prior art

- **Conceptual Prior Art**: One common-sense application of the worlds client is
  a general cloud platform that acts like a SaaS-layer dashboard user interface
  and REST API on top of the worlds client.
- **Ecosystem Goal**: Use the client library to develop new peripherals,
  developer tools, or full-stack interfaces on top of the worlds knowledge
  engine.

### Node.js and Bun package installation

Instead of using complex local linking tools like `yalc` or `npm link`, you can
pull JSR packages directly into Node.js, Bun, or Yarn environments:

```bash
# Node.js projects
npx jsr add @worlds/client

# Bun projects
bunx jsr add @worlds/client

# Yarn projects
yarn dlx jsr add @worlds/client

# Pnpm projects
pnpm dlx jsr add @worlds/client
```

This automates compiler bindings and resolves dependencies cleanly for modern
frontend runtimes.

### API interactions for user interface development

When building UI views, follow these two patterns to retrieve and mutate data:

#### Data retrieval (Search-then-SPARQL)

1. **Search**: Search for user queries or labels to discover subject IRIs.
   ```typescript
   const searchResponse = await client.search({ query: "Harry Potter" });
   const subjectUri = searchResponse.results[0].subject;
   ```
2. **Traverse**: Fetch structured data using subject-bound SPARQL queries.
   ```typescript
   const sparqlResponse = await client.sparql({
     query: `SELECT ?p ?o WHERE { <${subjectUri}> ?p ?o }`,
   });
   ```

#### Data mutation

- Use `client.import()` to transactionalize additions/merges.
  ```typescript
  await client.import({
    source: {
      kind: "serialized",
      contentType: "text/turtle",
      data: `<http://example.com/s> <http://example.com/p> "new value" .`,
    },
  });
  ```
