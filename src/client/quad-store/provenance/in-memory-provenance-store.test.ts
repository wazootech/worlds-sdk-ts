import { expect, test } from "bun:test";
import { InMemoryProvenanceStore } from "./in-memory-provenance-store.ts";

test("InMemoryProvenanceStore.record defaults recordedAt to write time", async () => {
  const store = new InMemoryProvenanceStore();
  const before = new Date().toISOString();
  const record = await store.record({ quadId: "q2.abc" });
  const after = new Date().toISOString();

  expect(record.quadId).toStrictEqual("q2.abc");
  expect(record.type).toStrictEqual(undefined);
  expect(
    record.recordedAt >= before && record.recordedAt <= after,
  ).toStrictEqual(true);
});

test("InMemoryProvenanceStore.record honors explicit recordedAt and metadata", async () => {
  const store = new InMemoryProvenanceStore();
  const record = await store.record({
    quadId: "q2.abc",
    recordedAt: "2026-01-01T00:00:00Z",
    writer: "agent-7",
    source: "nightly-feed",
    supersedesQuadId: "q2.old",
  });

  expect(record.recordedAt).toStrictEqual("2026-01-01T00:00:00Z");
  expect(record.writer).toStrictEqual("agent-7");
  expect(record.source).toStrictEqual("nightly-feed");
  expect(record.supersedesQuadId).toStrictEqual("q2.old");
});

test("InMemoryProvenanceStore is append-only", async () => {
  const store = new InMemoryProvenanceStore();
  await store.record({ quadId: "q2.abc", recordedAt: "2026-01-01T00:00:00Z" });
  const second = await store.record({ quadId: "q2.abc" });

  const all = await store.list();
  expect(all.length).toStrictEqual(2);
  expect(second.recordedAt !== "2026-01-01T00:00:00Z").toStrictEqual(true);
});

test("InMemoryProvenanceStore.list filters by quadId and type", async () => {
  const store = new InMemoryProvenanceStore();
  await store.record({
    quadId: "q2.a",
    type: "write",
    recordedAt: "2026-01-01T00:00:00Z",
  });
  await store.record({
    quadId: "q2.b",
    type: "write",
    recordedAt: "2026-01-02T00:00:00Z",
  });
  await store.record({
    quadId: "q2.a",
    type: "remove",
    recordedAt: "2026-01-03T00:00:00Z",
  });

  expect((await store.list({ quadId: "q2.a" })).length).toStrictEqual(2);
  expect((await store.list({ quadId: "q2.zzz" })).length).toStrictEqual(0);
  expect((await store.list({ type: "remove" })).length).toStrictEqual(1);
  expect((await store.list()).length).toStrictEqual(3);
});

test("InMemoryProvenanceStore.history walks supersedes chains in both directions", async () => {
  const store = new InMemoryProvenanceStore();
  // Chain: original -> correction -> second correction.
  await store.record({ quadId: "q2.v1", recordedAt: "2026-01-01T00:00:00Z" });
  await store.record({
    quadId: "q2.v2",
    recordedAt: "2026-01-02T00:00:00Z",
    supersedesQuadId: "q2.v1",
  });
  await store.record({
    quadId: "q2.v3",
    recordedAt: "2026-01-03T00:00:00Z",
    supersedesQuadId: "q2.v2",
  });

  const middle = await store.history("q2.v2");
  expect(middle.supersedes.length).toStrictEqual(1);
  expect(middle.supersedes[0].quadId).toStrictEqual("q2.v1");
  expect(middle.supersededBy.length).toStrictEqual(1);
  expect(middle.supersededBy[0].quadId).toStrictEqual("q2.v3");

  const oldest = await store.history("q2.v1");
  expect(oldest.supersedes.length).toStrictEqual(0);
  expect(oldest.supersededBy.map((r) => r.quadId).sort()).toStrictEqual([
    "q2.v2",
    "q2.v3",
  ]);

  const newest = await store.history("q2.v3");
  expect(newest.supersedes.map((r) => r.quadId).sort()).toStrictEqual([
    "q2.v1",
    "q2.v2",
  ]);
  expect(newest.supersededBy.length).toStrictEqual(0);
});

test("InMemoryProvenanceStore.history returns an empty chain for unknown quads", async () => {
  const store = new InMemoryProvenanceStore();
  const history = await store.history("q2.unknown");

  expect(history.quadId).toStrictEqual("q2.unknown");
  expect(history.supersedes.length).toStrictEqual(0);
  expect(history.supersededBy.length).toStrictEqual(0);
});

test("InMemoryProvenanceStore.history tolerates cyclic supersedes chains", async () => {
  const store = new InMemoryProvenanceStore();
  await store.record({ quadId: "q2.a", supersedesQuadId: "q2.b" });
  await store.record({ quadId: "q2.b", supersedesQuadId: "q2.a" });

  const history = await store.history("q2.a");
  // The walk terminates instead of looping forever; both edges are reachable.
  expect(
    history.supersedes.length + history.supersededBy.length >= 1,
  ).toStrictEqual(true);
});
