import { assertEquals } from "@std/assert";
import { InMemoryProvenanceStore } from "./in-memory-provenance-store.ts";

Deno.test("InMemoryProvenanceStore.record defaults recordedAt to write time", async () => {
  const store = new InMemoryProvenanceStore();
  const before = new Date().toISOString();
  const record = await store.record({ quadId: "q2.abc" });
  const after = new Date().toISOString();

  assertEquals(record.quadId, "q2.abc");
  assertEquals(record.type, undefined);
  assertEquals(
    record.recordedAt >= before && record.recordedAt <= after,
    true,
    "recordedAt should default to the write time",
  );
});

Deno.test("InMemoryProvenanceStore.record honors explicit recordedAt and metadata", async () => {
  const store = new InMemoryProvenanceStore();
  const record = await store.record({
    quadId: "q2.abc",
    recordedAt: "2026-01-01T00:00:00Z",
    writer: "agent-7",
    source: "nightly-feed",
    supersedesQuadId: "q2.old",
  });

  assertEquals(record.recordedAt, "2026-01-01T00:00:00Z");
  assertEquals(record.writer, "agent-7");
  assertEquals(record.source, "nightly-feed");
  assertEquals(record.supersedesQuadId, "q2.old");
});

Deno.test("InMemoryProvenanceStore is append-only", async () => {
  const store = new InMemoryProvenanceStore();
  await store.record({ quadId: "q2.abc", recordedAt: "2026-01-01T00:00:00Z" });
  const second = await store.record({ quadId: "q2.abc" });

  const all = await store.list();
  assertEquals(all.length, 2);
  assertEquals(second.recordedAt !== "2026-01-01T00:00:00Z", true);
});

Deno.test("InMemoryProvenanceStore.list filters by quadId and type", async () => {
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

  assertEquals((await store.list({ quadId: "q2.a" })).length, 2);
  assertEquals((await store.list({ quadId: "q2.zzz" })).length, 0);
  assertEquals((await store.list({ type: "remove" })).length, 1);
  assertEquals((await store.list()).length, 3);
});

Deno.test("InMemoryProvenanceStore.history walks supersedes chains in both directions", async () => {
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
  assertEquals(middle.supersedes.length, 1);
  assertEquals(middle.supersedes[0].quadId, "q2.v1");
  assertEquals(middle.supersededBy.length, 1);
  assertEquals(middle.supersededBy[0].quadId, "q2.v3");

  const oldest = await store.history("q2.v1");
  assertEquals(oldest.supersedes.length, 0);
  assertEquals(oldest.supersededBy.map((r) => r.quadId).sort(), [
    "q2.v2",
    "q2.v3",
  ]);

  const newest = await store.history("q2.v3");
  assertEquals(newest.supersedes.map((r) => r.quadId).sort(), [
    "q2.v1",
    "q2.v2",
  ]);
  assertEquals(newest.supersededBy.length, 0);
});

Deno.test("InMemoryProvenanceStore.history returns an empty chain for unknown quads", async () => {
  const store = new InMemoryProvenanceStore();
  const history = await store.history("q2.unknown");

  assertEquals(history.quadId, "q2.unknown");
  assertEquals(history.supersedes.length, 0);
  assertEquals(history.supersededBy.length, 0);
});

Deno.test("InMemoryProvenanceStore.history tolerates cyclic supersedes chains", async () => {
  const store = new InMemoryProvenanceStore();
  await store.record({ quadId: "q2.a", supersedesQuadId: "q2.b" });
  await store.record({ quadId: "q2.b", supersedesQuadId: "q2.a" });

  const history = await store.history("q2.a");
  // The walk terminates instead of looping forever; both edges are reachable.
  assertEquals(
    history.supersedes.length + history.supersededBy.length >= 1,
    true,
  );
});
