import { expect, test } from "bun:test";
import { DataFactory, Store } from "n3";
import { hashQuad } from "@/client/quad-store/mod.ts";
import { RdfjsQuadStore, recordPatchProvenance } from "./rdfjs-quad-store.ts";

const { quad, namedNode, literal, blankNode } = DataFactory;

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

test("RdfjsQuadStore.import records write provenance for every quad", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  const records = await quadStore.provenanceStore.list();
  expect(records.length).toStrictEqual(2);
  for (const record of records) {
    expect(record.type).toStrictEqual("write");
    expect(record.writer).toStrictEqual("agent-7");
    expect(record.source).toStrictEqual("nightly-feed");
    expect(record.recordedAt !== undefined).toStrictEqual(true);
  }
  expect(records.map((record) => record.quadId).sort()).toStrictEqual([hashQuad(fixtureQuad1), hashQuad(fixtureQuad2)].sort());
});

test("RdfjsQuadStore.import defaults recordedAt to write time when provenance is absent", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });

  const records = await quadStore.provenanceStore.list();
  expect(records.length).toStrictEqual(1);
  expect(records[0].type).toStrictEqual("write");
  expect(records[0].writer).toStrictEqual(undefined);
  expect(records[0].source).toStrictEqual(undefined);
  expect(isNaN(Date.parse(records[0].recordedAt))).toStrictEqual(false);
});

test("RdfjsQuadStore.import serialized source records provenance too", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  await quadStore.import({
    source: {
      kind: "serialized",
      data: `<http://example.org/s3> <http://example.org/p3> "value3" .`,
      contentType: "text/turtle",
    },
    provenance: { source: "turtle-upload" },
  });

  const records = await quadStore.provenanceStore.list();
  expect(records.length).toStrictEqual(1);
  expect(records[0].source).toStrictEqual("turtle-upload");
});

test("RdfjsQuadStore.replace import records removal tombstones for wiped quads", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1] },
    provenance: { writer: "first-writer" },
  });

  await quadStore.import({
    mode: "replace",
    source: { kind: "quads", quads: [fixtureQuad2] },
    provenance: { writer: "second-writer" },
  });

  const removed = await quadStore.provenanceStore.list({ type: "remove" });
  expect(removed.length).toStrictEqual(1);
  expect(removed[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));
  // The tombstone records the removal event within the import that caused it,
  // so it carries that import's provenance metadata.
  expect(removed[0].writer).toStrictEqual("second-writer");

  // Both imports' write records persist; the replace only tombstones the wipe.
  const written = await quadStore.provenanceStore.list({ type: "write" });
  expect(written.length).toStrictEqual(2);
  const secondWrite = written.find((record) =>
    record.quadId === hashQuad(fixtureQuad2)
  );
  expect(secondWrite?.writer).toStrictEqual("second-writer");
});

test("recordPatchProvenance links supersedesQuadId when a patch replaces a quad in place", async () => {
  const original = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("old-value"),
  );
  const corrected = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("new-value"),
  );
  const quadStore = new RdfjsQuadStore({ store: new Store() });
  await quadStore.import({ source: { kind: "quads", quads: [original] } });

  await recordPatchProvenance({
    provenanceStore: quadStore.provenanceStore,
    patch: { insertions: [corrected], deletions: [original] },
    context: { provenance: { writer: "v2" } },
  });

  const writeRecord = await quadStore.provenanceStore.list({
    quadId: hashQuad(corrected),
  });
  expect(writeRecord.length).toStrictEqual(1);
  expect(writeRecord[0].writer).toStrictEqual("v2");
  expect(writeRecord[0].supersedesQuadId).toStrictEqual(hashQuad(original));

  const tombstone = await quadStore.provenanceStore.list({
    quadId: hashQuad(original),
    type: "remove",
  });
  expect(tombstone.length).toStrictEqual(1);

  const history = await quadStore.provenanceStore.history(hashQuad(corrected));
  expect(history.supersedes.map((record) => record.quadId)).toStrictEqual([
    hashQuad(original),
  ]);
});

test("RdfjsQuadStore.provenanceQuery pairs quads with records and history", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7" },
  });

  const response = await quadStore.provenanceQuery({
    subject: namedNode("http://example.org/s1"),
  });

  expect(response.results.length).toStrictEqual(1);
  const result = response.results[0];
  expect(result.quadId).toStrictEqual(hashQuad(fixtureQuad1));
  expect(result.quad.equals(fixtureQuad1)).toStrictEqual(true);
  expect(result.records.length).toStrictEqual(1);
  expect(result.records[0].writer).toStrictEqual("agent-7");
  expect(result.history.supersedes.length).toStrictEqual(0);
  expect(result.history.supersededBy.length).toStrictEqual(0);
});

test("RdfjsQuadStore.provenanceQuery matches by object term", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
  });

  const response = await quadStore.provenanceQuery({
    object: literal("value2"),
  });
  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].quadId).toStrictEqual(hashQuad(fixtureQuad2));
});

test("RdfjsQuadStore.provenanceQuery returns quads without records as written pre-provenance", async () => {
  const store = new Store();
  store.add(fixtureQuad1);
  const quadStore = new RdfjsQuadStore({ store });

  const response = await quadStore.provenanceQuery({});

  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));
  expect(response.results[0].records.length).toStrictEqual(0);
  expect(response.results[0].history.supersededBy.length).toStrictEqual(0);
});

test("RdfjsQuadStore.provenanceQuery returns both quads of a merge correction", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  const original = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("old-value"),
  );
  const corrected = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("new-value"),
  );

  await quadStore.import({ source: { kind: "quads", quads: [original] } });
  await quadStore.import({ source: { kind: "quads", quads: [corrected] } });

  // Merge imports keep both quads live; supersession across removals is
  // exercised by the recordPatchProvenance test above.
  const response = await quadStore.provenanceQuery({
    subject: namedNode("http://example.org/s1"),
  });
  expect(response.results.length).toStrictEqual(2);
});

test("RdfjsQuadStore records provenance for blank-node quads without failing", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  const bnodeQuad = quad(
    blankNode("b1"),
    namedNode("http://example.org/p1"),
    literal("value1"),
  );

  await quadStore.import({
    source: { kind: "quads", quads: [bnodeQuad] },
    provenance: { writer: "agent-7" },
  });

  const response = await quadStore.provenanceQuery({});
  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].records.length).toStrictEqual(1);
});

test("RdfjsQuadStore honors an injected provenanceStore", async () => {
  const store = new Store();
  const seen: string[] = [];
  const quadStore = new RdfjsQuadStore({
    store,
    provenanceStore: {
      record: (input) => {
        seen.push(input.quadId);
        return Promise.resolve({
          ...input,
          recordedAt: input.recordedAt ?? "2026-01-01T00:00:00Z",
        });
      },
      list: () => Promise.resolve([]),
      history: (quadId) =>
        Promise.resolve({
          quadId,
          supersedes: [],
          supersededBy: [],
        }),
    },
  });

  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });
  expect(seen).toStrictEqual([hashQuad(fixtureQuad1)]);
});
