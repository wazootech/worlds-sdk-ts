import { expect, test } from "bun:test";
import type { ExportRequest, ImportRequest } from "@/client/quad-store/mod.ts";
import { DataFactory, Store } from "n3";
import { RdfjsQuadStore } from "./rdfjs-quad-store.ts";

const { namedNode, blankNode, quad, literal } = DataFactory;

// Test quads
const fixtureQuad1 = quad(
  namedNode("http://example.org/s1"),
  namedNode("http://example.org/p1"),
  literal("value1"),
);
const fixtureQuad2 = quad(
  namedNode("http://example.org/s2"),
  namedNode("http://example.org/p2"),
  literal("value2"),
);

test("RdfjsQuadStore.import - merge mode combines quads without deleting existing", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    mode: "merge",
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  expect(store.size).toStrictEqual(2);
  expect(store.has(fixtureQuad1)).toStrictEqual(true);
  expect(store.has(fixtureQuad2)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - replace mode wipes existing data before importing", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    mode: "replace",
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  expect(store.size).toStrictEqual(1);
  expect(store.has(fixtureQuad1)).toStrictEqual(false);
  expect(store.has(fixtureQuad2)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - source: dataset handles DatasetCore objects", async () => {
  const targetStore = new Store();
  const sourceDataset = new Store();
  sourceDataset.add(fixtureQuad1);
  sourceDataset.add(fixtureQuad2);

  await new RdfjsQuadStore({ store: targetStore }).import({
    source: {
      kind: "dataset",
      dataset: sourceDataset,
    },
  });

  expect(targetStore.size).toStrictEqual(2);
});

test("RdfjsQuadStore.import - source: serialized parses Turtle successfully", async () => {
  const store = new Store();
  const turtle = `<http://example.org/s3> <http://example.org/p3> "value" .`;

  await new RdfjsQuadStore({ store }).import({
    source: {
      kind: "serialized",
      data: turtle,
      contentType: "text/turtle",
    },
  });

  expect(store.size).toStrictEqual(1);
});

test("RdfjsQuadStore.import - source: serialized defaults to N-Quads", async () => {
  const store = new Store();
  const nQuads =
    `<http://example.org/s4> <http://example.org/p4> <http://example.org/o4> <http://example.org/g4> .`;
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "serialized", data: nQuads },
  });
  expect(store.size).toStrictEqual(1);
});

test("RdfjsQuadStore.import - replace mode combined with serialized data clears", async () => {
  const store = new Store();
  store.add(fixtureQuad1);
  await new RdfjsQuadStore({ store }).import({
    mode: "replace",
    source: {
      kind: "serialized",
      data: `<http://new> <http://new> "new" .`,
      contentType: "text/turtle",
    },
  });
  expect(store.size).toStrictEqual(1);
  expect(store.has(fixtureQuad1)).toStrictEqual(false);
});

test("RdfjsQuadStore.import - replace mode preserves existing data when serialized import fails", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await expect((async () => {
    await new RdfjsQuadStore({ store }).import({
      mode: "replace",
      source: {
        kind: "serialized",
        data: "GARBAGE SNOT@@$",
        contentType: "text/turtle",
      },
    });
  })()).rejects.toThrow();

  expect(store.size).toStrictEqual(1);
  expect(store.has(fixtureQuad1)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - invalid serialization rejects properly", async () => {
  const store = new Store();

  await expect((async () => {
    await new RdfjsQuadStore({ store }).import({
      source: {
        kind: "serialized",
        data: "GARBAGE SNOT@@$",
        contentType: "text/turtle",
      },
    });
  })()).rejects.toThrow();
});

test("RdfjsQuadStore.import - omitting mode defaults to merge", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  expect(store.size).toStrictEqual(2);
});

test("RdfjsQuadStore.import - handles BlankNode subjects", async () => {
  const store = new Store();
  const bSubject = blankNode("b1");
  const testQuad = quad(
    bSubject,
    namedNode("http://example.org/p"),
    literal("v"),
  );
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "quads", quads: [testQuad] },
  });
  expect(store.size).toStrictEqual(1);
  expect(store.has(testQuad)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - handles BlankNode objects", async () => {
  const store = new Store();
  const bObject = blankNode("b2");
  const testQuad = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    bObject,
  );
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "quads", quads: [testQuad] },
  });
  expect(store.size).toStrictEqual(1);
  expect(store.has(testQuad)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - handles NamedNode graph context", async () => {
  const store = new Store();
  const graph = namedNode("http://example.org/g");
  const testQuad = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("v"),
    graph,
  );
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "quads", quads: [testQuad] },
  });
  expect(store.size).toStrictEqual(1);
  expect(store.has(testQuad)).toStrictEqual(true);
});

test("RdfjsQuadStore.import - handles BlankNode graph context", async () => {
  const store = new Store();
  const graph = blankNode("g1");
  const testQuad = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("v"),
    graph,
  );
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "quads", quads: [testQuad] },
  });
  expect(store.size).toStrictEqual(1);
  expect(store.has(testQuad)).toStrictEqual(true);
});

test("RdfjsQuadStore.export - returns all store quads directly", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  const response = await new RdfjsQuadStore({ store }).export({
    format: { kind: "quads" },
  });

  if (response.kind !== "quads") throw new Error("Expected kind quads");
  expect(response.quads.length).toStrictEqual(1);
});

test("RdfjsQuadStore.export - rejects invalid export format", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await expect(new RdfjsQuadStore({ store }).export(
        {
          format: { kind: "invalid" },
        } as unknown as ExportRequest,
      )).rejects.toThrow("Invalid format requested");
});

test("RdfjsQuadStore.import - rejects unsupported import source kind", async () => {
  const store = new Store();

  await expect(new RdfjsQuadStore({ store }).import(
        {
          source: { kind: "unknown" },
        } as unknown as ImportRequest,
      )).rejects.toThrow("Unsupported import source kind");
});

test("RdfjsQuadStore.export - returns serialized dump", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  const response = await new RdfjsQuadStore({ store }).export({
    format: { kind: "serialized", contentType: "text/turtle" },
  });

  if (response.kind !== "serialized") throw new Error("Expected serialized");
  expect(response.contentType).toStrictEqual("text/turtle");
  expect(response.data.includes("value1")).toStrictEqual(true);
});

/**
 * Verifies one-world-many-graphs guarantee (workspace#71, #179): a single
 * world can hold the default graph plus multiple named graphs, and an
 * export round-trip preserves every graph membership.
 */
test("RdfjsQuadStore - multi-graph import and export round-trip preserves all graphs", async () => {
  const defaultGraphQuad = quad(
    namedNode("urn:alice"),
    namedNode("urn:likes"),
    literal("sailing"),
  );
  const publicGraphQuad = quad(
    namedNode("urn:alice"),
    namedNode("urn:posted"),
    literal("alice wrote a public note"),
    namedNode("urn:graph:public"),
  );
  const privateGraphQuad = quad(
    namedNode("urn:alice"),
    namedNode("urn:stores"),
    literal("confidential key material"),
    namedNode("urn:graph:private"),
  );

  const store = new Store();
  const rdfjsStore = new RdfjsQuadStore({ store });

  await rdfjsStore.import({
    source: {
      kind: "quads",
      quads: [defaultGraphQuad, publicGraphQuad, privateGraphQuad],
    },
  });

  // All three quads imported across three distinct graphs
  expect(store.size).toStrictEqual(3);

  // Export and verify every graph survives the round-trip
  const response = await rdfjsStore.export({ format: { kind: "quads" } });
  if (response.kind !== "quads") throw new Error("Expected kind quads");

  const graphValues = response.quads.map((q) => q.graph.value).sort();
  expect(graphValues).toStrictEqual(["", "urn:graph:private", "urn:graph:public"]);

  // Verify each specific quad survived
  expect(response.quads.some((q) =>
      q.graph.value === "" && q.subject.value === "urn:alice" &&
      q.object.value === "sailing"
    )).toStrictEqual(true);
  expect(response.quads.some((q) =>
      q.graph.value === "urn:graph:public" &&
      q.object.value === "alice wrote a public note"
    )).toStrictEqual(true);
  expect(response.quads.some((q) =>
      q.graph.value === "urn:graph:private" &&
      q.object.value === "confidential key material"
    )).toStrictEqual(true);
});
