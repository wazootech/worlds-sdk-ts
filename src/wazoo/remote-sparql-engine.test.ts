import { expect, test } from "bun:test";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteSparqlEngine } from "./remote-sparql-engine.ts";

// --- RemoteSparqlEngine tests ---

test("RemoteSparqlEngine.execute delegates to sparqlWorld", async () => {
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

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual("/worlds/{id}/sparql");
  expect(result.kind).toStrictEqual("select");
  if (result.kind === "select") {
    expect(result.data.head.vars).toStrictEqual(["p", "o"]);
    expect(result.data.results.bindings.length).toStrictEqual(1);
    expect(result.data.results.bindings[0].p.type).toStrictEqual("uri");
    expect((result.data.results.bindings[0].p as { value: string }).value).toStrictEqual("http://example.com/p");
  }
});

test("RemoteSparqlEngine.execute handles ASK responses", async () => {
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

  expect(result.kind).toStrictEqual("ask");
  if (result.kind === "ask") {
    expect(result.data.boolean).toStrictEqual(true);
  }
});

test("RemoteSparqlEngine.execute handles CONSTRUCT responses", async () => {
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

  expect(result.kind).toStrictEqual("construct");
  if (result.kind === "construct") {
    expect(result.data.quads.length).toStrictEqual(1);
    expect(result.data.quads[0].subject.value).toStrictEqual("http://example.com/s");
  }
});

test("RemoteSparqlEngine.execute parses literal terms in CONSTRUCT", async () => {
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

  expect(result.kind).toStrictEqual("construct");
  if (result.kind === "construct") {
    expect(result.data.quads.length).toStrictEqual(4);

    // Typed literal
    const typed = result.data.quads[0].object;
    expect(typed.termType).toStrictEqual("Literal");
    expect(typed.value).toStrictEqual("hello");
    if (typed.termType === "Literal") {
      expect(typed.datatype.value).toStrictEqual("http://www.w3.org/2001/XMLSchema#string");
    }

    // Language-tagged literal
    const lang = result.data.quads[1].object;
    expect(lang.termType).toStrictEqual("Literal");
    if (lang.termType === "Literal") {
      expect(lang.value).toStrictEqual("bonjour");
      expect(lang.language).toStrictEqual("fr");
    }

    // Blank node
    const bnode = result.data.quads[2].object;
    expect(bnode.termType).toStrictEqual("BlankNode");
    expect(bnode.value).toStrictEqual("b0");

    // Named node
    const named = result.data.quads[3].object;
    expect(named.termType).toStrictEqual("NamedNode");
    expect(named.value).toStrictEqual("http://example.com/target");
  }
});

test("RemoteSparqlEngine.execute throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/sparql": undefined,
  });

  const engine = new RemoteSparqlEngine(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await expect(engine.execute({ query: "SELECT ?s WHERE { ?s ?p ?o }" })).rejects.toThrow("SPARQL failed");
});
