import { expect, test } from "bun:test";
import { DataFactory, Store } from "n3";
import {
  hashQuad,
  InMemoryChangeLogStore,
  recordPatchChangeLog,
} from "@/client/quad-store/mod.ts";
import { RdfjsQuadStore } from "./rdfjs-quad-store.ts";

const { quad, namedNode, literal } = DataFactory;

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

test("RdfjsQuadStore.import writes no change-log rows when the log is off", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });

  expect(quadStore.changeLogEnabled).toStrictEqual(false);
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  expect(await quadStore.changeLogStore.list()).toStrictEqual([]);
  // The change log is off by default; sidecar provenance still records.
  expect((await quadStore.provenanceStore.list()).length).toStrictEqual(2);
});

test("RdfjsQuadStore.import records add entries with actor and source when the log is on", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store, changeLogEnabled: true });

  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  const entries = await quadStore.changeLogStore.list();
  expect(entries.length).toStrictEqual(2);
  for (const entry of entries) {
    expect(entry.operation).toStrictEqual("add");
    expect(entry.actor).toStrictEqual("agent-7");
    expect(entry.source).toStrictEqual("nightly-feed");
    expect(isNaN(Date.parse(entry.recordedAt))).toStrictEqual(false);
  }
  // One transaction groups both entries under one transaction id.
  expect(
    new Set(entries.map((entry) => entry.transactionId)).size,
  ).toStrictEqual(1);
  expect(entries.map((entry) => entry.sequence)).toStrictEqual([1, 2]);
  expect(entries.map((entry) => entry.quadId).sort()).toStrictEqual(
    [hashQuad(fixtureQuad1), hashQuad(fixtureQuad2)].sort(),
  );
});

test("RdfjsQuadStore.replace import records a remove for the wiped quad and keeps it in the log", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store, changeLogEnabled: true });
  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });

  await quadStore.import({
    mode: "replace",
    source: { kind: "quads", quads: [fixtureQuad2] },
    provenance: { writer: "second-writer" },
  });

  const removed = await quadStore.changeLogStore.list({ operation: "remove" });
  expect(removed.length).toStrictEqual(1);
  expect(removed[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));
  expect(removed[0].quad.equals(fixtureQuad1)).toStrictEqual(true);
  expect(removed[0].actor).toStrictEqual("second-writer");

  // The deleted fact remains in the log: its history shows the add then the remove.
  const history = await quadStore.changeLogStore.history(
    hashQuad(fixtureQuad1),
  );
  expect(history.map((entry) => entry.operation)).toStrictEqual([
    "add",
    "remove",
  ]);

  // The store itself only holds the replacement quad.
  const exported = await quadStore.export({ format: { kind: "quads" } });
  expect(exported.kind).toStrictEqual("quads");
  if (exported.kind === "quads") {
    expect(exported.quads.length).toStrictEqual(1);
    expect(exported.quads[0].equals(fixtureQuad2)).toStrictEqual(true);
  }
});

test("ChangeLogStore.asOfSequence reconstructs the state after each transaction", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store, changeLogEnabled: true });
  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });
  const firstEntries = await quadStore.changeLogStore.list();
  await quadStore.import({
    mode: "replace",
    source: { kind: "quads", quads: [fixtureQuad2] },
  });

  const stateAfterFirstImport = await quadStore.changeLogStore.asOfSequence(
    firstEntries[firstEntries.length - 1].sequence,
  );
  expect(stateAfterFirstImport.length).toStrictEqual(1);
  expect(stateAfterFirstImport[0].equals(fixtureQuad1)).toStrictEqual(true);

  const currentEntries = await quadStore.changeLogStore.list();
  const stateAfterReplace = await quadStore.changeLogStore.asOfSequence(
    currentEntries[currentEntries.length - 1].sequence,
  );
  expect(stateAfterReplace.length).toStrictEqual(1);
  expect(stateAfterReplace[0].equals(fixtureQuad2)).toStrictEqual(true);
});

test("ChangeLogStore.asOf reconstructs state before the log and at the far future", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store, changeLogEnabled: true });
  await quadStore.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
  });

  expect(
    await quadStore.changeLogStore.asOf("1970-01-01T00:00:00.000Z"),
  ).toStrictEqual([]);
  const farFuture = await quadStore.changeLogStore.asOf(
    "2999-01-01T00:00:00.000Z",
  );
  expect(farFuture.length).toStrictEqual(2);
});

test("RdfjsQuadStore.import writes no change-log rows when the commit fails", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({
    store,
    changeLogEnabled: true,
    commit: async () => {
      throw new Error("commit failed");
    },
  });

  await expect(
    quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } }),
  ).rejects.toThrow("commit failed");
  expect(await quadStore.changeLogStore.list()).toStrictEqual([]);
  expect(store.size).toStrictEqual(0);
});

test("RdfjsQuadStore.import writes no change-log rows for an empty import", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store, changeLogEnabled: true });

  await quadStore.import({ source: { kind: "quads", quads: [] } });

  expect(await quadStore.changeLogStore.list()).toStrictEqual([]);
});

test("recordPatchChangeLog records removals and additions under one transaction", async () => {
  const changeLogStore = new InMemoryChangeLogStore();
  const corrected = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("new-value"),
  );

  const entries = await recordPatchChangeLog({
    changeLogStore,
    patch: { insertions: [corrected], deletions: [fixtureQuad1] },
    context: { provenance: { writer: "v2", source: "correction-feed" } },
    transactionId: "transaction-1",
  });

  expect(entries.map((entry) => entry.operation)).toStrictEqual([
    "remove",
    "add",
  ]);
  expect(entries.map((entry) => entry.transactionId)).toStrictEqual([
    "transaction-1",
    "transaction-1",
  ]);
  expect(entries[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));
  expect(entries[1].quadId).toStrictEqual(hashQuad(corrected));
  expect(entries[1].actor).toStrictEqual("v2");
  expect(entries[1].source).toStrictEqual("correction-feed");

  expect(
    await changeLogStore.list({ transactionId: "transaction-1" }),
  ).toStrictEqual(entries);
  expect(await changeLogStore.list({ transactionId: "other" })).toStrictEqual(
    [],
  );
});

test("RdfjsQuadStore honors an injected changeLogStore", async () => {
  const store = new Store();
  const changeLogStore = new InMemoryChangeLogStore();
  const quadStore = new RdfjsQuadStore({
    store,
    changeLogEnabled: true,
    changeLogStore,
  });

  await quadStore.import({ source: { kind: "quads", quads: [fixtureQuad1] } });

  expect(await changeLogStore.list()).toHaveLength(1);
  expect(quadStore.changeLogStore).toStrictEqual(changeLogStore);
});
