import { assertEquals, assertRejects } from "@std/assert";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteSparqlEngine } from "./remote-sparql-engine.ts";

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
