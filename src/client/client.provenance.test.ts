import { expect, test } from "bun:test";
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

test("WorldsSdk.provenance returns records for matching quads", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
    provenance: { writer: "agent-7", source: "nightly-feed" },
  });

  const response = await client.provenance({
    subject: namedNode("http://example.org/s1"),
  });

  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));
  expect(response.results[0].records.length).toStrictEqual(1);
  expect(response.results[0].records[0].writer).toStrictEqual("agent-7");
  expect(response.results[0].records[0].source).toStrictEqual("nightly-feed");
  expect(response.results[0].history.supersededBy.length).toStrictEqual(0);
});

test("WorldsSdk.provenance with no pattern matches every quad", async () => {
  const store = new Store();
  const client = createTestClient(store);

  await client.import({
    source: { kind: "quads", quads: [fixtureQuad1, fixtureQuad2] },
  });

  const response = await client.provenance({});
  expect(response.results.length).toStrictEqual(2);
});

test("WorldsSdk.provenance returns empty records for pre-provenance quads", async () => {
  const store = new Store();
  store.add(fixtureQuad1);
  const client = createTestClient(store);

  const response = await client.provenance({});

  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].records.length).toStrictEqual(0);
  expect(response.results[0].history.supersedes.length).toStrictEqual(0);
  expect(response.results[0].history.supersededBy.length).toStrictEqual(0);
});

test("WorldsSdk.provenance walks the supersedes chain in both directions", async () => {
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
  expect(successor.results.length).toStrictEqual(1);
  expect(successor.results[0].quadId).toStrictEqual(hashQuad(corrected));
  expect(successor.results[0].records.length).toStrictEqual(1);
  expect(successor.results[0].records[0].writer).toStrictEqual("v2");

  const history = successor.results[0].history;
  expect(history.supersedes.length).toStrictEqual(1);
  expect(history.supersedes[0].quadId).toStrictEqual(hashQuad(fixtureQuad1));

  // The removed quad keeps both its write record and its removal tombstone.
  const originalRecords = await quadStore.provenanceStore.list({
    quadId: hashQuad(fixtureQuad1),
  });
  expect(originalRecords.length).toStrictEqual(2); // write + remove tombstone
  expect(originalRecords.map((record) => record.type).sort()).toStrictEqual(["remove", "write"]);
});

test("WorldsSdk.provenance prefers an explicit provenance handler", async () => {
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
  expect(response.results.length).toStrictEqual(1);
  expect(response.results[0].quadId).toStrictEqual("q2.custom");
});

test("WorldsSdk.provenance rejects when nothing can serve provenance", async () => {
  const client = new WorldsSdk({});

  await expect(client.provenance({})).rejects.toThrow("Provenance is not configured.");
});
