import { DataFactory } from "n3";
import { assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteQuadStore } from "./remote-quad-store.ts";

const { namedNode, literal, quad } = DataFactory;

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
