import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { generateSyntheticQuads } from "../../../benchmarks/shared/synthetic-data.ts";
import { collectQuadsFromStream } from "@/client/quad-store/mod.ts";
import { seedDenokvQuadsForTest } from "@/denokv/create-denokv-stores-for-test.ts";
import { DEFAULT_DENOKV_QUAD_INDEXES } from "@/denokv/kv/denokv-index-set.ts";
import { DenokvRdfjsStore } from "@/denokv/rdfjs-store/mod.ts";
import { buildBestMatchSelector } from "@/denokv/kv/denokv-match-selector.ts";

const { namedNode, literal, blankNode, quad } = DataFactory;

function collectMatch(
  store: DenokvRdfjsStore,
  subject?: rdfjs.Term | null,
  predicate?: rdfjs.Term | null,
  object?: rdfjs.Term | null,
  graph?: rdfjs.Term | null,
): Promise<rdfjs.Quad[]> {
  return collectQuadsFromStream(store.match(subject, predicate, object, graph));
}

Deno.test("DEFAULT_DENOKV_QUAD_INDEXES - enables all seven quad-native families", () => {
  assertEquals(DEFAULT_DENOKV_QUAD_INDEXES.length, 7);
  assertEquals(
    [...DEFAULT_DENOKV_QUAD_INDEXES],
    ["spog", "sopg", "psog", "posg", "ospg", "opsg", "gspo"],
  );
});

Deno.test("DenokvRdfjsStore.match - empty store returns empty stream", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(store, null, null, null, null);
    assertEquals(results.length, 0);
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - all four terms bound returns exact quad", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(
        namedNode("urn:alice"),
        namedNode("urn:knows"),
        namedNode("urn:bob"),
        namedNode("urn:graph1"),
      ),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      namedNode("urn:alice"),
      namedNode("urn:knows"),
      namedNode("urn:bob"),
      namedNode("urn:graph1"),
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].subject.value, "urn:alice");
    assertEquals(results[0].subject.termType, "NamedNode");
    assertEquals(results[0].predicate.value, "urn:knows");
    assertEquals(results[0].object.value, "urn:bob");
    assertEquals(results[0].graph.value, "urn:graph1");
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - by subject only returns matching quads", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(namedNode("urn:a"), namedNode("urn:p1"), literal("o1")),
      quad(namedNode("urn:b"), namedNode("urn:p2"), literal("o2")),
      quad(namedNode("urn:a"), namedNode("urn:p3"), literal("o3")),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      namedNode("urn:a"),
      null,
      null,
      null,
    );

    assertEquals(results.length, 2);
    for (const quad of results) {
      assertEquals(quad.subject.value, "urn:a");
    }
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - by predicate only uses PSO index", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(namedNode("urn:a"), namedNode("urn:target"), literal("o1")),
      quad(namedNode("urn:b"), namedNode("urn:other"), literal("o2")),
      quad(namedNode("urn:c"), namedNode("urn:target"), literal("o3")),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      null,
      namedNode("urn:target"),
      null,
      null,
    );

    assertEquals(results.length, 2);
    for (const quad of results) {
      assertEquals(quad.predicate.value, "urn:target");
    }
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - by graph only uses GPSO index", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(
        namedNode("urn:a"),
        namedNode("urn:p"),
        literal("o1"),
        namedNode("urn:g1"),
      ),
      quad(
        namedNode("urn:b"),
        namedNode("urn:p"),
        literal("o2"),
        namedNode("urn:g2"),
      ),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      null,
      null,
      null,
      namedNode("urn:g1"),
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].graph.value, "urn:g1");
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - by object only uses OPSG index", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(namedNode("urn:a"), namedNode("urn:p"), literal("target")),
      quad(namedNode("urn:b"), namedNode("urn:p"), literal("other")),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      null,
      null,
      literal("target"),
      null,
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].object.value, "target");
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - disambiguates NamedNode vs BlankNode with same value", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(namedNode("b1"), namedNode("urn:p"), literal("o1")),
      quad(blankNode("b1"), namedNode("urn:p"), literal("o2")),
    ]);

    const store = new DenokvRdfjsStore({ kv });

    const namedResults = await collectMatch(
      store,
      namedNode("b1"),
      null,
      null,
      null,
    );
    assertEquals(namedResults.length, 1);
    assertEquals(namedResults[0].subject.termType, "NamedNode");

    const blankResults = await collectMatch(
      store,
      blankNode("b1"),
      null,
      null,
      null,
    );
    assertEquals(blankResults.length, 1);
    assertEquals(blankResults[0].subject.termType, "BlankNode");
  } finally {
    kv.close();
  }
});

Deno.test("DenokvRdfjsStore.match - literal with language tag", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    await seedDenokvQuadsForTest(kv, [
      quad(
        namedNode("urn:s"),
        namedNode("urn:p"),
        literal("hola", "es"),
      ),
    ]);

    const store = new DenokvRdfjsStore({ kv });
    const results = await collectMatch(
      store,
      namedNode("urn:s"),
      namedNode("urn:p"),
      null,
      null,
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].object.termType, "Literal");
    const objectLiteral = results[0].object as rdfjs.Literal;
    assertEquals(objectLiteral.value, "hola");
    assertEquals(objectLiteral.language, "es");
  } finally {
    kv.close();
  }
});

Deno.test(
  "DenokvRdfjsStore.match - by subject and object uses SOPG index",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(namedNode("urn:a"), namedNode("urn:p1"), literal("target")),
        quad(namedNode("urn:a"), namedNode("urn:p2"), literal("other")),
        quad(namedNode("urn:b"), namedNode("urn:p1"), literal("target")),
      ]);

      const store = new DenokvRdfjsStore({ kv });
      const results = await collectMatch(
        store,
        namedNode("urn:a"),
        null,
        literal("target"),
        null,
      );

      assertEquals(results.length, 1);
      assertEquals(results[0].predicate.value, "urn:p1");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvRdfjsStore.match - by object and predicate uses OPSG index",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(namedNode("urn:a"), namedNode("urn:p1"), literal("target")),
        quad(namedNode("urn:a"), namedNode("urn:p2"), literal("other")),
        quad(namedNode("urn:b"), namedNode("urn:p1"), literal("target")),
      ]);

      const store = new DenokvRdfjsStore({
        kv,
        enabledQuadIndexes: ["opsg"],
      });
      const results = await collectMatch(
        store,
        null,
        namedNode("urn:p1"),
        literal("target"),
        null,
      );

      assertEquals(results.length, 2);
      for (const result of results) {
        assertEquals(result.predicate.value, "urn:p1");
        assertEquals(result.object.value, "target");
      }
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvRdfjsStore.match - by predicate and subject uses PSOG index",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(namedNode("urn:a"), namedNode("urn:p1"), literal("o1")),
        quad(namedNode("urn:a"), namedNode("urn:p2"), literal("o2")),
        quad(namedNode("urn:b"), namedNode("urn:p1"), literal("o3")),
      ]);

      const store = new DenokvRdfjsStore({
        kv,
        enabledQuadIndexes: ["psog"],
      });
      const results = await collectMatch(
        store,
        namedNode("urn:a"),
        namedNode("urn:p1"),
        null,
        null,
      );

      assertEquals(results.length, 1);
      assertEquals(results[0].subject.value, "urn:a");
      assertEquals(results[0].predicate.value, "urn:p1");
      assertEquals(results[0].object.value, "o1");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvRdfjsStore.countQuads - returns exact counts for bound patterns",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("urn:alice"),
          namedNode("urn:knows"),
          namedNode("urn:bob"),
        ),
        quad(namedNode("urn:alice"), namedNode("urn:age"), literal("30")),
        quad(
          namedNode("urn:carol"),
          namedNode("urn:knows"),
          namedNode("urn:dave"),
        ),
      ]);

      const store = new DenokvRdfjsStore({ kv });

      assertEquals(await store.countQuads(null, null, null, null), 3);
      assertEquals(
        await store.countQuads(namedNode("urn:alice"), null, null, null),
        2,
      );
      assertEquals(
        await store.countQuads(
          namedNode("urn:alice"),
          namedNode("urn:knows"),
          null,
          null,
        ),
        1,
      );

      const streamCount = (await collectMatch(
        store,
        namedNode("urn:alice"),
        null,
        null,
        null,
      )).length;
      assertEquals(
        await store.countQuads(namedNode("urn:alice"), null, null, null),
        streamCount,
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test("buildBestMatchSelector - fully unbound pattern uses primary quads prefix", () => {
  const selector = buildBestMatchSelector(
    ["quads", "g", 0],
    DEFAULT_DENOKV_QUAD_INDEXES,
    { subject: null, predicate: null, object: null, graph: null },
  );
  assertEquals(selector, { prefix: ["quads", "g", 0, "quads"] });
});

Deno.test(
  "DenokvRdfjsStore.match - unbound pattern streams first 100 quads without full corpus scan",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, generateSyntheticQuads(800));

      const store = new DenokvRdfjsStore({ kv });
      const startedAt = performance.now();
      const earlyQuads = await new Promise<rdfjs.Quad[]>((resolve, reject) => {
        const collectedQuads: rdfjs.Quad[] = [];
        const matchStream = store.match(null, null, null, null);

        matchStream.on("data", (matchedQuad: rdfjs.Quad) => {
          collectedQuads.push(matchedQuad);
          if (collectedQuads.length >= 100) {
            (matchStream as unknown as { destroy: () => void }).destroy();
          }
        });
        matchStream.on("close", () => resolve(collectedQuads));
        matchStream.on("error", reject);
      });

      const elapsedMilliseconds = performance.now() - startedAt;
      assertEquals(earlyQuads.length, 100);
      if (elapsedMilliseconds >= 5_000) {
        throw new Error(
          `unbound match took ${elapsedMilliseconds}ms; expected under 5000ms`,
        );
      }
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvRdfjsStore.match - predicate-only still correct when only spog index enabled",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(namedNode("urn:a"), namedNode("urn:target"), literal("o1")),
        quad(namedNode("urn:b"), namedNode("urn:other"), literal("o2")),
      ]);

      const store = new DenokvRdfjsStore({
        kv,
        enabledQuadIndexes: ["spog"],
      });
      const results = await collectMatch(
        store,
        null,
        namedNode("urn:target"),
        null,
        null,
      );

      assertEquals(results.length, 1);
      assertEquals(results[0].predicate.value, "urn:target");
    } finally {
      kv.close();
    }
  },
);
