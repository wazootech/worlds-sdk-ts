import { assertEquals } from "@std/assert";
import { DataFactory } from "n3";
import {
  createDenokvStoresForTest,
  seedDenokvQuadsForTest,
} from "@/denokv/create-denokv-stores-for-test.ts";
import { commitPatchToDenokv } from "@/denokv/commit-patch-to-denokv.ts";
import { DenokvSearchIndex } from "./denokv-search-index.ts";

const { namedNode, literal, quad } = DataFactory;

/** customKeyPrefix is a non-default Deno Kv namespace used by prefix isolation tests. */
const customKeyPrefix = ["tenant", "quads"];

Deno.test(
  "DenokvSearchIndex.search - returns literal matching text locally",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("http://example.com/entity1"),
          namedNode("http://example.com/hasDesc"),
          literal("Found some delicious tacos for lunch"),
        ),
        quad(
          namedNode("http://example.com/entity2"),
          namedNode("http://example.com/hasDesc"),
          literal("Boring non-matching payload"),
        ),
      ]);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({ query: "Tacos" });

      assertEquals(response.results?.length, 1);
      assertEquals(
        response.results?.[0].text,
        "Found some delicious tacos for lunch",
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - inclusion filters strictly limit results to allowed subjects",
  async () => {
    const kv = await Deno.openKv(":memory:");
    const targetSubject = "http://example.com/target";
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode(targetSubject),
          namedNode("http://example.com/desc"),
          literal("Match me!"),
        ),
        quad(
          namedNode("http://example.com/wrong"),
          namedNode("http://example.com/desc"),
          literal("Match me!"),
        ),
      ]);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({
        query: "match",
        include: { subjects: [targetSubject] },
      });

      assertEquals(response.results?.length, 1);
      assertEquals(response.results?.[0].subject, targetSubject);
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - exclusion filters correctly strip matching predicates",
  async () => {
    const kv = await Deno.openKv(":memory:");
    const excludePred = "http://example.com/hidden";
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("http://example.com/subject"),
          namedNode(excludePred),
          literal("Secret text query"),
        ),
      ]);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({
        query: "secret",
        exclude: { predicates: [excludePred] },
      });

      assertEquals(
        response.results?.length,
        0,
        "Excluded predicate hit should have been filtered out",
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - ignores structured primitives to suppress search space noise",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("http://example.com/s1"),
          namedNode("http://example.com/p1"),
          literal("The magic number is 42"),
        ),
        quad(
          namedNode("http://example.com/s2"),
          namedNode("http://example.com/p1"),
          literal(
            "42",
            namedNode("http://www.w3.org/2001/XMLSchema#integer"),
          ),
        ),
      ]);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({ query: "42" });

      assertEquals(
        response.results?.length,
        1,
        "Expected raw integer literal to be completely ignored in search index matching",
      );
      assertEquals(
        response.results?.[0].text,
        "The magic number is 42",
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - matches case-insensitively on query and stored text",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("http://example.com/s"),
          namedNode("http://example.com/p"),
          literal("UPPERCASE KEYWORD inside value"),
        ),
      ]);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({ query: "keyword" });

      assertEquals(response.results?.length, 1);
      assertEquals(
        response.results?.[0].text,
        "UPPERCASE KEYWORD inside value",
      );
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - skips empty or missing serialized KV values",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await seedDenokvQuadsForTest(kv, [
        quad(
          namedNode("http://example.com/s"),
          namedNode("http://example.com/p"),
          literal("Valid searchable text"),
        ),
      ]);

      await kv.set(["quads", "corrupt-entry"], null);

      const searchIndex = new DenokvSearchIndex({ kv });
      const response = await searchIndex.search({ query: "searchable" });

      assertEquals(response.results?.length, 1);
      assertEquals(response.results?.[0].text, "Valid searchable text");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - after replace returns literals from active generation only",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      const { denokvQuadStore } = createDenokvStoresForTest({ kv });
      await denokvQuadStore.import({
        mode: "merge",
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode("http://example.com/old"),
              namedNode("http://example.com/p"),
              literal("stale tacos"),
            ),
          ],
        },
      });

      await denokvQuadStore.import({
        mode: "replace",
        source: {
          kind: "quads",
          quads: [
            quad(
              namedNode("http://example.com/new"),
              namedNode("http://example.com/p"),
              literal("fresh tacos"),
            ),
          ],
        },
      });

      const searchIndex = new DenokvSearchIndex({ kv });
      const staleResponse = await searchIndex.search({ query: "stale" });
      assertEquals(staleResponse.results?.length, 0);

      const freshResponse = await searchIndex.search({ query: "fresh" });
      assertEquals(freshResponse.results?.length, 1);
      assertEquals(freshResponse.results?.[0].text, "fresh tacos");
    } finally {
      kv.close();
    }
  },
);

Deno.test(
  "DenokvSearchIndex.search - respects custom keyPrefix when scanning KV",
  async () => {
    const kv = await Deno.openKv(":memory:");
    try {
      await commitPatchToDenokv(
        {
          insertions: [
            quad(
              namedNode("http://example.com/tenant"),
              namedNode("http://example.com/p"),
              literal("Tenant scoped document"),
            ),
          ],
          deletions: [],
        },
        { kv, keyPrefix: customKeyPrefix },
      );

      const defaultPrefixIndex = new DenokvSearchIndex({ kv });
      const defaultResponse = await defaultPrefixIndex.search({
        query: "tenant",
      });
      assertEquals(defaultResponse.results?.length, 0);

      const tenantIndex = new DenokvSearchIndex({
        kv,
        keyPrefix: customKeyPrefix,
      });
      const tenantResponse = await tenantIndex.search({ query: "tenant" });
      assertEquals(tenantResponse.results?.length, 1);
      assertEquals(
        tenantResponse.results?.[0].text,
        "Tenant scoped document",
      );
    } finally {
      kv.close();
    }
  },
);
