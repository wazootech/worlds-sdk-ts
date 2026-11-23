import { expect, test } from "bun:test";
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

test("preparePatch - filters both sides and hashes in order", () => {
  const prepared = preparePatch(
    { insertions: [a, b], deletions: [c, a] },
    { exclude: { subjects: ["urn:b"] } },
  );
  expect(prepared.insertions).toStrictEqual([a]);
  expect(prepared.insertionIds).toStrictEqual([hashQuad(a)]);
  expect(prepared.deletions).toStrictEqual([c, a]);
  expect(prepared.deletionIds).toStrictEqual([hashQuad(c), hashQuad(a)]);
});

test("preparePatch - does not deduplicate within a side", () => {
  const prepared = preparePatch({ insertions: [a, a], deletions: [] });
  expect(prepared.insertions.length).toStrictEqual(2);
});

test("computeNovelQuads - keeps only quads the store lacks", async () => {
  const result = await computeNovelQuads(
    { insertions: [a, b], deletions: [] },
    { lookupExisting: storing([hashQuad(a)]) },
  );
  expect(result.novelInsertions).toStrictEqual([b]);
  expect(result.novelQuadIds).toStrictEqual([hashQuad(b)]);
});

test("selectNovelQuads - a stored quad deleted in the same patch is novel again", async () => {
  const prepared = preparePatch({ insertions: [a, b], deletions: [a] });
  const result = await selectNovelQuads(prepared, {
    lookupExisting: storing([hashQuad(a), hashQuad(b)]),
  });
  expect(result.novelInsertions).toStrictEqual([a]);
});

test("selectNovelQuads - replacing treats nothing as existing and skips the lookup", async () => {
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
  expect(result.novelInsertions).toStrictEqual([a, b]);
  expect(lookups).toStrictEqual(0);
});

test("selectNovelQuads - no insertions means no lookup", async () => {
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
  expect(result).toStrictEqual({ novelInsertions: [], novelQuadIds: [] });
  expect(lookups).toStrictEqual(0);
});

test("selectNovelQuads - keyOf swaps the identity used for lookup and deletion", async () => {
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
  expect(seen).toStrictEqual([["urn:a|a", "urn:b|b"]]);
  expect(result.novelInsertions).toStrictEqual([b]);
});

test("selectNovelQuads - passes duplicates to the lookup and keeps each novel copy", async () => {
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
  expect(seen[0]!.length).toStrictEqual(2);
  expect(result.novelInsertions).toStrictEqual([a, a]);
});

test("selectNovelQuads - a failing lookup rejects", async () => {
  await expect(selectNovelQuads(preparePatch({ insertions: [a], deletions: [] }), {
        lookupExisting: () => Promise.reject(new Error("db down")),
      })).rejects.toThrow("db down");
});
