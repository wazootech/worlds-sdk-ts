import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { DataFactory } from "n3";
import { createDenokvClient } from "./create-denokv-client.ts";

const { quad, namedNode, literal } = DataFactory;
const queryEngine = new QueryEngine();

Deno.test(
  "createDenokvClient - import delivers search hits from Deno Kv",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      const client = createDenokvClient({ kv });
      const testQuad = quad(
        namedNode("urn:person:alice"),
        namedNode("urn:bio"),
        literal("Alice explores coastal tide pools."),
      );

      await client.import({ source: { kind: "quads", quads: [testQuad] } });

      const response = await client.search({ query: "coastal" });
      assertExists(response.results);
      assertEquals(response.results.length, 1);
      assertEquals(response.results[0].subject, "urn:person:alice");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "createDenokvClient - export round-trips imported quads",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      const client = createDenokvClient({ kv });
      const testQuad = quad(
        namedNode("urn:doc:1"),
        namedNode("urn:title"),
        literal("Export me"),
      );

      await client.import({ source: { kind: "quads", quads: [testQuad] } });

      const response = await client.export({ format: { kind: "quads" } });
      if (response.kind !== "quads") {
        throw new Error("Expected quads format response");
      }

      assertEquals(response.quads.length, 1);
      assertEquals(response.quads[0].object.value, "Export me");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "createDenokvClient - queryEngine SPARQL reads from Deno KV",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      const client = createDenokvClient({
        kv,
        queryEngine,
      });

      await client.import({
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode("urn:person:dana"),
              namedNode("urn:bio"),
              literal("Dana surveys alpine ridgelines."),
            ),
          ],
        },
      });

      const response = await client.sparql({
        query: "SELECT ?text WHERE { <urn:person:dana> <urn:bio> ?text }",
      });

      if (response.kind !== "select") {
        throw new Error("Expected select response kind");
      }

      assertEquals(response.data.results.bindings.length, 1);
      assertEquals(
        response.data.results.bindings[0].text?.value,
        "Dana surveys alpine ridgelines.",
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "createDenokvClient - sparql rejects when queryEngine is omitted",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      const client = createDenokvClient({ kv });

      await assertRejects(
        () => client.sparql({ query: "ASK WHERE { ?s ?p ?o }" }),
        Error,
        "SPARQL engine is not configured.",
      );
    } finally {
      kv.close();
    }
  },
);
