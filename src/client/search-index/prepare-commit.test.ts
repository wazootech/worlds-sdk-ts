import { expect, test } from "bun:test";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { hashQuad } from "@/client/quad-store/mod.ts";
import type { EmbeddingService } from "./embedding-service/embedding-service.ts";
import type { TextSplitterInterface } from "./quad-chunker/chunk-quads.ts";
import { prepareCommit, type PrepareCommitOptions } from "./prepare-commit.ts";

const { quad, namedNode, literal } = DataFactory;
const g = namedNode("urn:g");
const make = (name: string) =>
  quad(namedNode(`urn:${name}`), namedNode("urn:p"), literal(name), g);
const a = make("a");
const b = make("b");
const c = make("c");
const wholeLiteral: TextSplitterInterface = {
  createDocuments: (texts, metadatas) =>
    Promise.resolve(
      texts.map((pageContent, i) => ({
        pageContent,
        metadata: metadatas?.[i],
      })),
    ),
};
const embedder = (calls: string[][]): EmbeddingService => ({
  embed: (texts) => {
    calls.push(texts);
    return Promise.resolve(texts.map(() => [1, 2]));
  },
});
const options = (
  extra: Partial<PrepareCommitOptions> = {},
  stored: rdfjs.Quad[] = [],
): PrepareCommitOptions => {
  const held = new Set(stored.map(hashQuad));
  return {
    lookupExisting: (keys) =>
      Promise.resolve(new Set(keys.filter((key) => held.has(key)))),
    projection: { textSplitter: wholeLiteral },
    ...extra,
  };
};
const ids = (quads: rdfjs.Quad[]) => quads.map(hashQuad);
const rowIds = (rows: { chunk: { quad_id: string } }[]) =>
  rows.map((row) => row.chunk.quad_id);
const merge = { importMode: "merge" } as const;
const patchOf = (insertions: rdfjs.Quad[], deletions: rdfjs.Quad[] = []) => ({
  insertions,
  deletions,
});

test("prepareCommit - incremental projects the novel quads only", async () => {
  const result = await prepareCommit(
    patchOf([a, b]),
    options({ searchIndexOnImport: "incremental" }, [a]),
  );
  expect(result.novel.novelInsertions).toStrictEqual([b]);
  expect(rowIds(result.rows)).toStrictEqual(ids([b]));
  expect(result.plan).toStrictEqual({
    projectDuringCommit: true,
    reindexAfterCommit: false,
  });
  expect(result.replacing).toStrictEqual(false);
});

test("prepareCommit - unset mode uses defaultMode, an explicit mode wins", async () => {
  const base = { context: merge, defaultMode: "deferred" } as const;
  const deferred = await prepareCommit(patchOf([a]), options(base));
  expect(deferred.rows).toStrictEqual([]);
  expect(deferred.plan.reindexAfterCommit).toBeTruthy();
  const explicit = await prepareCommit(
    patchOf([a]),
    options({ ...base, searchIndexOnImport: "incremental" }),
  );
  expect(rowIds(explicit.rows)).toStrictEqual(ids([a]));
});

test("prepareCommit - a deferred import skips projection but still finds novel quads", async () => {
  const result = await prepareCommit(
    patchOf([a, b]),
    options({ searchIndexOnImport: "deferred", context: merge }, [a]),
  );
  expect(result.rows).toStrictEqual([]);
  expect(result.novel.novelInsertions).toStrictEqual([b]);
  expect(result.plan).toStrictEqual({
    projectDuringCommit: false,
    reindexAfterCommit: true,
  });
  const ordinary = await prepareCommit(
    patchOf([b]),
    options({ searchIndexOnImport: "deferred" }),
  );
  expect(rowIds(ordinary.rows)).toStrictEqual(ids([b]));
  expect(ordinary.plan.reindexAfterCommit).toStrictEqual(false);
});

test("prepareCommit - disabled mode projects nothing and never reindexes", async () => {
  const result = await prepareCommit(
    patchOf([a]),
    options({ searchIndexOnImport: "disabled" }),
  );
  expect(result.rows).toStrictEqual([]);
  expect(result.novel.novelInsertions).toStrictEqual([a]);
  expect(result.plan.reindexAfterCommit).toStrictEqual(false);
});

test("prepareCommit - no projection means no rows", async () => {
  const result = await prepareCommit(
    patchOf([a]),
    options({ projection: undefined }),
  );
  expect(result.rows).toStrictEqual([]);
  expect(result.novel.novelInsertions).toStrictEqual([a]);
});

test("prepareCommit - the filter drops quads from storage and projection", async () => {
  const result = await prepareCommit(
    patchOf([a, b], [c, b]),
    options({ exclude: { subjects: ["urn:b"] } }),
  );
  expect(result.prepared.insertions).toStrictEqual([a]);
  expect(result.prepared.deletions).toStrictEqual([c]);
  expect(result.prepared.deletionIds).toStrictEqual(ids([c]));
  expect(result.novel.novelInsertions).toStrictEqual([a]);
  expect(rowIds(result.rows)).toStrictEqual(ids([a]));
});

test("prepareCommit - a quad deleted and re-added is novel even when stored", async () => {
  const result = await prepareCommit(patchOf([a, b], [a]), options({}, [a, b]));
  expect(result.novel.novelInsertions).toStrictEqual([a]);
  expect(rowIds(result.rows)).toStrictEqual(ids([a]));
  expect(result.prepared.deletionIds).toStrictEqual(ids([a]));
});

test("prepareCommit - a replace import ignores stored quads and skips the lookup", async () => {
  let lookups = 0;
  const result = await prepareCommit(
    patchOf([a, b]),
    options({
      context: { importMode: "replace" },
      lookupExisting: () => {
        lookups++;
        return Promise.resolve(new Set(ids([a, b])));
      },
    }),
  );
  expect(result.replacing).toBeTruthy();
  expect(lookups).toStrictEqual(0);
  expect(result.novel.novelInsertions).toStrictEqual([a, b]);
  expect(rowIds(result.rows)).toStrictEqual(ids([a, b]));
});

test("prepareCommit - keyOf feeds the lookup and the novel check", async () => {
  const seen: string[][] = [];
  const result = await prepareCommit(
    patchOf([a, b]),
    options({
      keyOf: (quadValue) => quadValue.subject.value,
      lookupExisting: (keys) => {
        seen.push(keys);
        return Promise.resolve(new Set(["urn:a"]));
      },
    }),
  );
  expect(seen).toStrictEqual([["urn:a", "urn:b"]]);
  expect(result.novel.novelInsertions).toStrictEqual([b]);
});

test("prepareCommit - when-projecting selects novel quads only to project them", async () => {
  let lookups = 0;
  const counting = {
    selectNovel: "when-projecting",
    lookupExisting: () => {
      lookups++;
      return Promise.resolve(new Set<string>());
    },
  } as const;
  const off = await prepareCommit(
    patchOf([a]),
    options({ ...counting, searchIndexOnImport: "disabled" }),
  );
  const bare = await prepareCommit(
    patchOf([a]),
    options({ ...counting, projection: undefined }),
  );
  expect(off.novel.novelInsertions).toStrictEqual([]);
  expect(bare.novel.novelInsertions).toStrictEqual([]);
  expect(lookups).toStrictEqual(0);
  const on = await prepareCommit(patchOf([a]), options(counting));
  expect(lookups).toStrictEqual(1);
  expect(on.novel.novelInsertions).toStrictEqual([a]);
});

test("prepareCommit - embeds only the novel texts and attaches vectors", async () => {
  const calls: string[][] = [];
  const result = await prepareCommit(
    patchOf([a, b]),
    options(
      {
        projection: {
          textSplitter: wholeLiteral,
          embeddingService: embedder(calls),
        },
      },
      [a],
    ),
  );
  expect(calls).toStrictEqual([["b"]]);
  expect(result.rows[0]?.vector).toStrictEqual([1, 2]);
});

test("prepareCommit - an embedding failure rejects before returning", async () => {
  const failing: EmbeddingService = {
    embed: () => Promise.reject(new Error("embedding service down")),
  };
  await expect(
    prepareCommit(
      patchOf([a]),
      options({
        projection: {
          textSplitter: wholeLiteral,
          embeddingService: failing,
        },
      }),
    ),
  ).rejects.toThrow("failed to vectorize literal chunk blocks");
});
