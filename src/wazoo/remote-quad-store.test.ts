import { DataFactory } from "n3";
import { expect, test } from "bun:test";
import type * as rdfjs from "@rdfjs/types";

import { createMockClient } from "./test-mock-client.ts";
import { RemoteQuadStore } from "./remote-quad-store.ts";

const { namedNode, literal, quad } = DataFactory;

// --- RemoteQuadStore tests ---

test("RemoteQuadStore.import serializes quads and calls importWorld", async () => {
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

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual("/worlds/{id}/import");
  expect(calls[0].method).toStrictEqual("POST");
  const body = calls[0].body as { data: string; contentType: string };
  expect(body.contentType).toStrictEqual("application/n-quads");
  expect(body.data.includes("http://example.com/s1")).toStrictEqual(true);
  expect(body.data.includes("hello")).toStrictEqual(true);
});

test("RemoteQuadStore.import passes serialized source directly", async () => {
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

  expect(calls.length).toStrictEqual(1);
  const body = calls[0].body as { data: string; contentType: string };
  expect(body.data).toStrictEqual(nquads);
  expect(body.contentType).toStrictEqual("text/turtle");
});

test("RemoteQuadStore.export returns quads from API", async () => {
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

  expect(calls.length).toStrictEqual(1);
  expect(calls[0].url).toStrictEqual("/worlds/{id}/export");
  expect(result.kind).toStrictEqual("quads");
  if (result.kind === "quads") {
    expect(result.quads.length).toStrictEqual(1);
    expect(result.quads[0].subject.value).toStrictEqual("http://example.com/s");
    expect(result.quads[0].predicate.value).toStrictEqual("http://example.com/p");
    expect(result.quads[0].object.value).toStrictEqual("hello");
  }
});

test("RemoteQuadStore.export serialized format returns string", async () => {
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

  expect(calls.length).toStrictEqual(1);
  expect(result.kind).toStrictEqual("serialized");
  if (result.kind === "serialized") {
    expect(typeof result.data).toStrictEqual("string");
    expect(result.contentType).toStrictEqual("application/n-quads");
  }
});

test("RemoteQuadStore.import throws on API error", async () => {
  const { client } = createMockClient({
    "/worlds/{id}/import": undefined,
  });

  const store = new RemoteQuadStore(
    client as import("@worlds/client").Client,
    "w_test",
  );

  await expect(store.import({
        mode: "merge",
        source: {
          kind: "serialized",
          data: "bad data",
          contentType: "text/turtle",
        },
      })).rejects.toThrow("Import failed");
});
