import { assertEquals } from "@std/assert";
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

Deno.test("RdfjsQuadStore.import records write provenance for every quad", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  const records = await quadStore.provenanceStore.list();
  assertEquals(records.length, 2);
  for (const record of records) {
    assertEquals(record.type, "write");
    assertEquals(record.writer, "agent-7");
    assertEquals(record.source, "nightly-feed");
    assertEquals(record.recordedAt !== undefined, true);
  }
  assertEquals(
    records.map((record) => record.quadId).sort(),
    [hashQuad(fixtureQuad1), hashQuad(fixtureQuad2)].sort(),
  );
});

Deno.test("RdfjsQuadStore.import defaults recordedAt to write time when provenance is absent", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });

  const records = await quadStore.provenanceStore.list();
  assertEquals(records.length, 1);
  assertEquals(records[0].type, "write");
  assertEquals(records[0].writer, undefined);
  assertEquals(records[0].source, undefined);
  assertEquals(isNaN(Date.parse(records[0].recordedAt)), false);
});

Deno.test("RdfjsQuadStore.import serialized source records provenance too", async () => {
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
  assertEquals(records.length, 1);
  assertEquals(records[0].source, "turtle-upload");
});

Deno.test("RdfjsQuadStore.replace import records removal tombstones for wiped quads", async () => {
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
  assertEquals(removed.length, 1);
  assertEquals(removed[0].quadId, hashQuad(fixtureQuad1));
  // The tombstone records the removal event within the import that caused it,
  // so it carries that import's provenance metadata.
  assertEquals(removed[0].writer, "second-writer");

  // Both imports' write records persist; the replace only tombstones the wipe.
  const written = await quadStore.provenanceStore.list({ type: "write" });
  assertEquals(written.length, 2);
  const secondWrite = written.find((record) =>
    record.quadId === hashQuad(fixtureQuad2)
  );
  assertEquals(secondWrite?.writer, "second-writer");
});

Deno.test("recordPatchProvenance links supersedesQuadId when a patch replaces a quad in place", async () => {
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
  assertEquals(writeRecord.length, 1);
  assertEquals(writeRecord[0].writer, "v2");
  assertEquals(writeRecord[0].supersedesQuadId, hashQuad(original));

  const tombstone = await quadStore.provenanceStore.list({
    quadId: hashQuad(original),
    type: "remove",
  });
  assertEquals(tombstone.length, 1);

  const history = await quadStore.provenanceStore.history(hashQuad(corrected));
  assertEquals(history.supersedes.map((record) => record.quadId), [
    hashQuad(original),
  ]);
});

Deno.test("RdfjsQuadStore.provenanceQuery pairs quads with records and history", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7" },
  });

  const response = await quadStore.provenanceQuery({
    subject: namedNode("http://example.org/s1"),
  });

  assertEquals(response.results.length, 1);
  const result = response.results[0];
  assertEquals(result.quadId, hashQuad(fixtureQuad1));
  assertEquals(result.quad.equals(fixtureQuad1), true);
  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].writer, "agent-7");
  assertEquals(result.history.supersedes.length, 0);
  assertEquals(result.history.supersededBy.length, 0);
});

Deno.test("RdfjsQuadStore.provenanceQuery matches by object term", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
  });

  const response = await quadStore.provenanceQuery({
    object: literal("value2"),
  });
  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].quadId, hashQuad(fixtureQuad2));
});

Deno.test("RdfjsQuadStore.provenanceQuery returns quads without records as written pre-provenance", async () => {
  const store = new Store();
  store.add(fixtureQuad1);
  const quadStore = new RdfjsQuadStore({ store });

  const response = await quadStore.provenanceQuery({});

  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].quadId, hashQuad(fixtureQuad1));
  assertEquals(response.results[0].records.length, 0);
  assertEquals(response.results[0].history.supersededBy.length, 0);
});

Deno.test("RdfjsQuadStore.provenanceQuery returns both quads of a merge correction", async () => {
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
  assertEquals(response.results.length, 2);
});

Deno.test("RdfjsQuadStore records provenance for blank-node quads without failing", async () => {
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
  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].records.length, 1);
});

Deno.test("RdfjsQuadStore honors an injected provenanceStore", async () => {
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
  assertEquals(seen, [hashQuad(fixtureQuad1)]);
});
