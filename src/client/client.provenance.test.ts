import { assertEquals, assertRejects } from "@std/assert";
import { DataFactory, Store } from "n3";
import { WorldsSdk } from "./client.ts";
import { RdfjsQuadStore } from "../rdfjs/mod.ts";
import { hashQuad } from "./quad-store/mod.ts";

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

function createTestClient(store: Store): WorldsSdk {
  return new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
  });
}

Deno.test("WorldsSdk.provenance returns records for matching quads", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  const response = await client.provenance({
    subject: namedNode("http://example.org/s1"),
  });

  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].quadId, hashQuad(fixtureQuad1));
  assertEquals(response.results[0].records.length, 1);
  assertEquals(response.results[0].records[0].writer, "agent-7");
  assertEquals(response.results[0].records[0].source, "nightly-feed");
  assertEquals(response.results[0].history.supersededBy.length, 0);
});

Deno.test("WorldsSdk.provenance with no pattern matches every quad", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
  });

  const response = await client.provenance({});
  assertEquals(response.results.length, 2);
});

Deno.test("WorldsSdk.provenance returns empty records for pre-provenance quads", async () => {
  const store = new Store();
  store.add(fixtureQuad1);
  const client = createTestClient(store);

  const response = await client.provenance({});

  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].records.length, 0);
  assertEquals(response.results[0].history.supersedes.length, 0);
  assertEquals(response.results[0].history.supersededBy.length, 0);
});

Deno.test("WorldsSdk.provenance walks the supersedes chain in both directions", async () => {
  const store = new Store();
  const quadStore = new RdfjsQuadStore({ store });
  const client = new WorldsSdk({ quadStore });

  await client.import({
    source: { kind: "quads", quads: [fixtureQuad1] },
    provenance: { writer: "v1" },
  });
  // Correction: remove the old quad, write the corrected one in its place.
  const corrected = quad(
    namedNode("http://example.org/s1"),
    namedNode("http://example.org/p1"),
    literal("corrected"),
  );
  // Simulate the applied patch: remove the old quad from the store, add the
  // corrected one, then record the sidecar provenance for the patch.
  const { recordPatchProvenance } = await import(
    "../rdfjs/rdfjs-quad-store.ts"
  );
  store.delete(fixtureQuad1);
  store.addQuad(corrected);
  await recordPatchProvenance({
    provenanceStore: quadStore.provenanceStore,
    patch: { insertions: [corrected], deletions: [fixtureQuad1] },
    context: { provenance: { writer: "v2" } },
  });

  // The corrected quad is now the only live one at this position; the removed
  // predecessor is traceable through its supersedes chain and its tombstone.
  const successor = await client.provenance({
    subject: namedNode("http://example.org/s1"),
  });
  assertEquals(successor.results.length, 1);
  assertEquals(successor.results[0].quadId, hashQuad(corrected));
  assertEquals(successor.results[0].records.length, 1);
  assertEquals(successor.results[0].records[0].writer, "v2");

  const history = successor.results[0].history;
  assertEquals(history.supersedes.length, 1);
  assertEquals(history.supersedes[0].quadId, hashQuad(fixtureQuad1));

  // The removed quad keeps both its write record and its removal tombstone.
  const originalRecords = await quadStore.provenanceStore.list({
    quadId: hashQuad(fixtureQuad1),
  });
  assertEquals(originalRecords.length, 2); // write + remove tombstone
  assertEquals(
    originalRecords.map((record) => record.type).sort(),
    ["remove", "write"],
  );
});

Deno.test("WorldsSdk.provenance prefers an explicit provenance handler", async () => {
  const client = new WorldsSdk({
    provenance: {
      provenanceQuery: () => {
        return Promise.resolve({
          results: [
            {
              quadId: "q2.custom",
              quad: fixtureQuad1,
              records: [],
              history: {
                quadId: "q2.custom",
                supersedes: [],
                supersededBy: [],
              },
            },
          ],
        });
      },
    },
  });

  const response = await client.provenance({});
  assertEquals(response.results.length, 1);
  assertEquals(response.results[0].quadId, "q2.custom");
});

Deno.test("WorldsSdk.provenance rejects when nothing can serve provenance", async () => {
  const client = new WorldsSdk({});

  await assertRejects(
    () => client.provenance({}),
    Error,
    "Provenance is not configured.",
  );
});
