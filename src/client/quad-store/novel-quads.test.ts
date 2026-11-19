import { assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { hashQuad } from "./hash-quad.ts";
import {
  computeNovelQuads,
  preparePatch,
  selectNovelQuads,
} from "./novel-quads.ts";

const { quad, namedNode, literal } = DataFactory;
const g = namedNode("urn:g");
const a = quad(namedNode("urn:a"), namedNode("urn:p"), literal("a"), g);
const b = quad(namedNode("urn:b"), namedNode("urn:p"), literal("b"), g);
const c = quad(namedNode("urn:c"), namedNode("urn:p"), literal("c"), g);

const storing = (stored: string[]) => (keys: string[]) =>
  Promise.resolve(new Set(keys.filter((key) => stored.includes(key))));

Deno.test("preparePatch - filters both sides and hashes in order", () => {
  const prepared = preparePatch(
    { insertions: [a, b], deletions: [c, a] },
    { exclude: { subjects: ["urn:b"] } },
  );
  assertEquals(prepared.insertions, [a]);
  assertEquals(prepared.insertionIds, [hashQuad(a)]);
  assertEquals(prepared.deletions, [c, a]);
  assertEquals(prepared.deletionIds, [hashQuad(c), hashQuad(a)]);
});

Deno.test("preparePatch - does not deduplicate within a side", () => {
  const prepared = preparePatch({ insertions: [a, a], deletions: [] });
  assertEquals(prepared.insertions.length, 2);
});

Deno.test("computeNovelQuads - keeps only quads the store lacks", async () => {
  const result = await computeNovelQuads(
    { insertions: [a, b], deletions: [] },
    { lookupExisting: storing([hashQuad(a)]) },
  );
  assertEquals(result.novelInsertions, [b]);
  assertEquals(result.novelQuadIds, [hashQuad(b)]);
});

Deno.test("selectNovelQuads - a stored quad deleted in the same patch is novel again", async () => {
  const prepared = preparePatch({ insertions: [a, b], deletions: [a] });
  const result = await selectNovelQuads(prepared, {
    lookupExisting: storing([hashQuad(a), hashQuad(b)]),
  });
  assertEquals(result.novelInsertions, [a]);
});

Deno.test("selectNovelQuads - replacing treats nothing as existing and skips the lookup", async () => {
  let lookups = 0;
  const result = await selectNovelQuads(
    preparePatch({ insertions: [a, b], deletions: [] }),
    {
      replacing: true,
      lookupExisting: () => {
        lookups++;
        return Promise.resolve(new Set([hashQuad(a)]));
      },
    },
  );
  assertEquals(result.novelInsertions, [a, b]);
  assertEquals(lookups, 0);
});

Deno.test("selectNovelQuads - no insertions means no lookup", async () => {
  let lookups = 0;
  const result = await selectNovelQuads(
    preparePatch({ insertions: [], deletions: [a] }),
    {
      lookupExisting: () => {
        lookups++;
        return Promise.resolve(new Set<string>());
      },
    },
  );
  assertEquals(result, { novelInsertions: [], novelQuadIds: [] });
  assertEquals(lookups, 0);
});

Deno.test("selectNovelQuads - keyOf swaps the identity used for lookup and deletion", async () => {
  const keyOf = (q: rdfjs.Quad) => `${q.subject.value}|${q.object.value}`;
  const seen: string[][] = [];
  const result = await selectNovelQuads(
    preparePatch({ insertions: [a, b], deletions: [b] }),
    {
      keyOf,
      lookupExisting: (keys) => {
        seen.push(keys);
        return Promise.resolve(new Set(keys));
      },
    },
  );
  assertEquals(seen, [["urn:a|a", "urn:b|b"]]);
  assertEquals(result.novelInsertions, [b]);
});

Deno.test("selectNovelQuads - passes duplicates to the lookup and keeps each novel copy", async () => {
  const seen: string[][] = [];
  const result = await selectNovelQuads(
    preparePatch({ insertions: [a, a], deletions: [] }),
    {
      lookupExisting: (keys) => {
        seen.push(keys);
        return Promise.resolve(new Set<string>());
      },
    },
  );
  assertEquals(seen[0]!.length, 2);
  assertEquals(result.novelInsertions, [a, a]);
});

Deno.test("selectNovelQuads - a failing lookup rejects", async () => {
  await assertRejects(
    () =>
      selectNovelQuads(preparePatch({ insertions: [a], deletions: [] }), {
        lookupExisting: () => Promise.reject(new Error("db down")),
      }),
    Error,
    "db down",
  );
});
