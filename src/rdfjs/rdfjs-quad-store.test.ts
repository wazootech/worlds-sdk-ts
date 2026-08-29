import { assertEquals, assertRejects } from "@std/assert";
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

Deno.test("RdfjsQuadStore.import - merge mode combines quads without deleting existing", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    mode: "merge",
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  assertEquals(store.size, 2);
  assertEquals(store.has(fixtureQuad1), true);
  assertEquals(store.has(fixtureQuad2), true);
});

Deno.test("RdfjsQuadStore.import - replace mode wipes existing data before importing", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    mode: "replace",
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  assertEquals(store.size, 1);
  assertEquals(store.has(fixtureQuad1), false);
  assertEquals(store.has(fixtureQuad2), true);
});

Deno.test("RdfjsQuadStore.import - source: dataset handles DatasetCore objects", async () => {
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

  assertEquals(targetStore.size, 2);
});

Deno.test("RdfjsQuadStore.import - source: serialized parses Turtle successfully", async () => {
  const store = new Store();
  const turtle = `<http://example.org/s3> <http://example.org/p3> "value" .`;

  await new RdfjsQuadStore({ store }).import({
    source: {
      kind: "serialized",
      data: turtle,
      contentType: "text/turtle",
    },
  });

  assertEquals(store.size, 1);
});

Deno.test("RdfjsQuadStore.import - source: serialized defaults to N-Quads", async () => {
  const store = new Store();
  const nQuads =
    `<http://example.org/s4> <http://example.org/p4> <http://example.org/o4> <http://example.org/g4> .`;
  await new RdfjsQuadStore({ store }).import({
    source: { kind: "serialized", data: nQuads },
  });
  assertEquals(store.size, 1);
});

Deno.test("RdfjsQuadStore.import - replace mode combined with serialized data clears", async () => {
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
  assertEquals(store.size, 1);
  assertEquals(store.has(fixtureQuad1), false);
});

Deno.test("RdfjsQuadStore.import - replace mode preserves existing data when serialized import fails", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await assertRejects(async () => {
    await new RdfjsQuadStore({ store }).import({
      mode: "replace",
      source: {
        kind: "serialized",
        data: "GARBAGE SNOT@@$",
        contentType: "text/turtle",
      },
    });
  });

  assertEquals(store.size, 1);
  assertEquals(store.has(fixtureQuad1), true);
});

Deno.test("RdfjsQuadStore.import - invalid serialization rejects properly", async () => {
  const store = new Store();

  await assertRejects(async () => {
    await new RdfjsQuadStore({ store }).import({
      source: {
        kind: "serialized",
        data: "GARBAGE SNOT@@$",
        contentType: "text/turtle",
      },
    });
  });
});

Deno.test("RdfjsQuadStore.import - omitting mode defaults to merge", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await new RdfjsQuadStore({ store }).import({
    source: {
      kind: "quads",
      quads: [fixtureQuad2],
    },
  });

  assertEquals(store.size, 2);
});

Deno.test("RdfjsQuadStore.import - handles BlankNode subjects", async () => {
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
  assertEquals(store.size, 1);
  assertEquals(store.has(testQuad), true);
});

Deno.test("RdfjsQuadStore.import - handles BlankNode objects", async () => {
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
  assertEquals(store.size, 1);
  assertEquals(store.has(testQuad), true);
});

Deno.test("RdfjsQuadStore.import - handles NamedNode graph context", async () => {
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
  assertEquals(store.size, 1);
  assertEquals(store.has(testQuad), true);
});

Deno.test("RdfjsQuadStore.import - handles BlankNode graph context", async () => {
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
  assertEquals(store.size, 1);
  assertEquals(store.has(testQuad), true);
});

Deno.test("RdfjsQuadStore.export - returns all store quads directly", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  const response = await new RdfjsQuadStore({ store }).export({
    format: { kind: "quads" },
  });

  if (response.kind !== "quads") throw new Error("Expected kind quads");
  assertEquals(response.quads.length, 1);
});

Deno.test("RdfjsQuadStore.export - rejects invalid export format", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  await assertRejects(
    () =>
      new RdfjsQuadStore({ store }).export(
        {
          format: { kind: "invalid" },
        } as unknown as ExportRequest,
      ),
    Error,
    "Invalid format requested",
  );
});

Deno.test("RdfjsQuadStore.import - rejects unsupported import source kind", async () => {
  const store = new Store();

  await assertRejects(
    () =>
      new RdfjsQuadStore({ store }).import(
        {
          source: { kind: "unknown" },
        } as unknown as ImportRequest,
      ),
    Error,
    "Unsupported import source kind",
  );
});

Deno.test("RdfjsQuadStore.export - returns serialized dump", async () => {
  const store = new Store();
  store.add(fixtureQuad1);

  const response = await new RdfjsQuadStore({ store }).export({
    format: { kind: "serialized", contentType: "text/turtle" },
  });

  if (response.kind !== "serialized") throw new Error("Expected serialized");
  assertEquals(response.contentType, "text/turtle");
  assertEquals(response.data.includes("value1"), true);
});

/**
 * Verifies one-world-many-graphs guarantee (workspace#71, #179): a single
 * world can hold the default graph plus multiple named graphs, and an
 * export round-trip preserves every graph membership.
 */
Deno.test("RdfjsQuadStore - multi-graph import and export round-trip preserves all graphs", async () => {
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
  assertEquals(store.size, 3);

  // Export and verify every graph survives the round-trip
  const response = await rdfjsStore.export({ format: { kind: "quads" } });
  if (response.kind !== "quads") throw new Error("Expected kind quads");

  const graphValues = response.quads.map((q) => q.graph.value).sort();
  assertEquals(
    graphValues,
    ["", "urn:graph:private", "urn:graph:public"],
    "default graph + two named graphs preserved after round-trip",
  );

  // Verify each specific quad survived
  assertEquals(
    response.quads.some((q) =>
      q.graph.value === "" && q.subject.value === "urn:alice" &&
      q.object.value === "sailing"
    ),
    true,
    "default-graph quad survived",
  );
  assertEquals(
    response.quads.some((q) =>
      q.graph.value === "urn:graph:public" &&
      q.object.value === "alice wrote a public note"
    ),
    true,
    "public-graph quad survived",
  );
  assertEquals(
    response.quads.some((q) =>
      q.graph.value === "urn:graph:private" &&
      q.object.value === "confidential key material"
    ),
    true,
    "private-graph quad survived",
  );
});
