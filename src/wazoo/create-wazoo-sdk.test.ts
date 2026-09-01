import { assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { createWazooSdk } from "./create-wazoo-sdk.ts";
import { RemoteQuadStore } from "./remote-quad-store.ts";
import { RemoteSearchIndex } from "./remote-search-index.ts";
import { RemoteSparqlEngine } from "./remote-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

// --- Mock client factory ---

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
  query?: unknown;
}

function createMockClient(
  responses: Record<string, unknown>,
): { client: unknown; calls: MockCall[] } {
  const calls: MockCall[] = [];

  const handler = {
    get(
      _target: unknown,
      prop: string,
    ): unknown {
      if (
        prop === "get" || prop === "post" || prop === "delete" ||
        prop === "patch"
      ) {
        return (config: Record<string, unknown>) => {
          calls.push({
            url: config.url as string,
            method: prop.toUpperCase(),
            body: config.body,
            query: config.query,
          });

          const url = config.url as string;
          const responseData = responses[url];

          if (responseData === undefined) {
            return Promise.resolve({
              data: null,
              error: { error: { code: "NOT_FOUND", message: "Not found" } },
            });
          }

          return Promise.resolve({ data: responseData, error: null });
        };
      }
      return undefined;
    },
  };

  return { client: new Proxy({}, handler), calls };
}

// --- RemoteQuadStore tests ---

Deno.test("RemoteQuadStore.import serializes quads and calls importWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/import": { imported: { quads: 2, chunks: 1 } },
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const quads: rdfjs.Quad[] = [
    quad(
      namedNode("http://example.com/s1"),
      namedNode("http://example.com/p1"),
      literal("hello"),
    ),
    quad(
      namedNode("http://example.com/s2"),
      namedNode("http://example.com/p2"),
      literal("world"),
    ),
  ];

  await store.import({
    mode: "merge",
    source: { kind: "quads", quads },
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/import");
  assertEquals(calls[0].method, "POST");
  const body = calls[0].body as { data: string; contentType: string };
  assertEquals(body.contentType, "application/n-quads");
  assertEquals(body.data.includes("http://example.com/s1"), true);
  assertEquals(body.data.includes("hello"), true);
});

Deno.test("RemoteQuadStore.import passes serialized source directly", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/import": { imported: { quads: 1, chunks: 1 } },
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const nquads = `<http://example.com/s> <http://example.com/p> "test" .`;

  await store.import({
    mode: "merge",
    source: { kind: "serialized", data: nquads, contentType: "text/turtle" },
  });

  assertEquals(calls.length, 1);
  const body = calls[0].body as { data: string; contentType: string };
  assertEquals(body.data, nquads);
  assertEquals(body.contentType, "text/turtle");
});

Deno.test("RemoteQuadStore.export returns quads from API", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/export": {
      quads: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          object: '"hello"',
        },
      ],
    },
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await store.export({ format: { kind: "quads" } });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/export");
  assertEquals(result.kind, "quads");
  if (result.kind === "quads") {
    assertEquals(result.quads.length, 1);
    assertEquals(result.quads[0].subject.value, "http://example.com/s");
    assertEquals(result.quads[0].predicate.value, "http://example.com/p");
    assertEquals(result.quads[0].object.value, "hello");
  }
});

Deno.test("RemoteQuadStore.export serialized format returns string", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/export": {
      quads: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          object: '"hello"',
        },
      ],
    },
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await store.export({
    format: { kind: "serialized", contentType: "application/n-quads" },
  });

  assertEquals(calls.length, 1);
  assertEquals(result.kind, "serialized");
  if (result.kind === "serialized") {
    assertEquals(typeof result.data, "string");
    assertEquals(result.contentType, "application/n-quads");
  }
});

Deno.test("RemoteQuadStore.import throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/import": undefined,
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await assertRejects(
    () =>
      store.import({
        mode: "merge",
        source: {
          kind: "serialized",
          data: "bad data",
          contentType: "text/turtle",
        },
      }),
    Error,
    "Import failed",
  );
});

// --- RemoteSearchIndex tests ---

Deno.test("RemoteSearchIndex.search delegates to searchWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/search": {
      results: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          graph: "http://example.com/g",
          content: "hello world",
          score: 0.95,
        },
      ],
    },
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await searchIndex.search({
    query: "hello",
    topK: 5,
    minScore: 0.5,
    include: {},
    exclude: {},
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/search");
  assertEquals(result.results?.length, 1);
  assertEquals(result.results?.[0].subject, "http://example.com/s");
  assertEquals(result.results?.[0].text, "hello world");
  assertEquals(result.results?.[0].score, 0.95);
  assertEquals(result.results?.[0].graph, "http://example.com/g");
});

Deno.test("RemoteSearchIndex.reindex delegates to reindexWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/reindex": { ok: true, status: "completed" },
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await searchIndex.reindex();

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/reindex");
  assertEquals(result.processedQuadCount, 0);
  assertEquals(result.chunkRowCount, 0);
});

Deno.test("RemoteSearchIndex.search throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/search": undefined,
  });

  const searchIndex = new RemoteSearchIndex(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await assertRejects(
    () =>
      searchIndex.search({
        query: "test",
        include: {},
        exclude: {},
      }),
    Error,
    "Search failed",
  );
});

// --- RemoteSparqlEngine tests ---

Deno.test("RemoteSparqlEngine.execute delegates to sparqlWorld", async () => {
  const { client, calls } = createMockClient({
    "/worlds/{id}/sparql": {
      head: { vars: ["p", "o"] },
      results: {
        bindings: [
          {
            p: { type: "uri", value: "http://example.com/p" },
            o: { type: "literal", value: "hello" },
          },
        ],
      },
    },
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await engine.execute({
    query: "SELECT ?p ?o WHERE { <http://example.com/s> ?p ?o }",
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "/worlds/{id}/sparql");
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.head.vars, ["p", "o"]);
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(result.data.results.bindings[0].p.type, "uri");
    assertEquals(
      (result.data.results.bindings[0].p as { value: string }).value,
      "http://example.com/p",
    );
  }
});

Deno.test("RemoteSparqlEngine.execute handles ASK responses", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/sparql": {
      head: {},
      boolean: true,
    },
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await engine.execute({
    query: "ASK WHERE { ?s ?p ?o }",
  });

  assertEquals(result.kind, "ask");
  if (result.kind === "ask") {
    assertEquals(result.data.boolean, true);
  }
});

Deno.test("RemoteSparqlEngine.execute handles CONSTRUCT responses", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/sparql": {
      head: {},
      quads: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          object: '"hello"',
        },
      ],
    },
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await engine.execute({
    query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
  });

  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    assertEquals(result.data.quads.length, 1);
    assertEquals(result.data.quads[0].subject.value, "http://example.com/s");
  }
});

Deno.test("RemoteSparqlEngine.execute parses literal terms in CONSTRUCT", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/sparql": {
      head: {},
      quads: [
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/p",
          object: '"hello"^^<http://www.w3.org/2001/XMLSchema#string>',
        },
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/lang",
          object: '"bonjour"@fr',
        },
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/node",
          object: "_:b0",
        },
        {
          subject: "http://example.com/s",
          predicate: "http://example.com/iri",
          object: "http://example.com/target",
        },
      ],
    },
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  const result = await engine.execute({
    query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
  });

  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    assertEquals(result.data.quads.length, 4);

    // Typed literal
    const typed = result.data.quads[0].object;
    assertEquals(typed.termType, "Literal");
    assertEquals(typed.value, "hello");
    if (typed.termType === "Literal") {
      assertEquals(
        typed.datatype.value,
        "http://www.w3.org/2001/XMLSchema#string",
      );
    }

    // Language-tagged literal
    const lang = result.data.quads[1].object;
    assertEquals(lang.termType, "Literal");
    if (lang.termType === "Literal") {
      assertEquals(lang.value, "bonjour");
      assertEquals(lang.language, "fr");
    }

    // Blank node
    const bnode = result.data.quads[2].object;
    assertEquals(bnode.termType, "BlankNode");
    assertEquals(bnode.value, "b0");

    // Named node
    const named = result.data.quads[3].object;
    assertEquals(named.termType, "NamedNode");
    assertEquals(named.value, "http://example.com/target");
  }
});

Deno.test("RemoteSparqlEngine.execute throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/sparql": undefined,
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await assertRejects(
    () => engine.execute({ query: "SELECT ?s WHERE { ?s ?p ?o }" }),
    Error,
    "SPARQL failed",
  );
});

// --- createWazooSdk factory test ---

Deno.test("createWazooSdk returns a WorldsSdkInterface", () => {
  const sdk = createWazooSdk({
    baseUrl: "https://data.wazoo.dev",
    token: "test-token",
    worldId: "w_test",
  });

  assertEquals(typeof sdk.import, "function");
  assertEquals(typeof sdk.export, "function");
  assertEquals(typeof sdk.search, "function");
  assertEquals(typeof sdk.sparql, "function");
  assertEquals(typeof sdk.reindex, "function");
});
