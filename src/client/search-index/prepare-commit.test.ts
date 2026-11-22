import { assert, assertEquals, assertRejects } from "@std/assert";
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

Deno.test("prepareCommit - incremental projects the novel quads only", async () => {
  const result = await prepareCommit(
    patchOf([a, b]),
    options({ searchIndexOnImport: "incremental" }, [a]),
  );
  assertEquals(result.novel.novelInsertions, [b]);
  assertEquals(rowIds(result.rows), ids([b]));
  assertEquals(result.plan, {
    projectDuringCommit: true,
    reindexAfterCommit: false,
  });
  assertEquals(result.replacing, false);
});

Deno.test("prepareCommit - unset mode uses defaultMode, an explicit mode wins", async () => {
  const base = { context: merge, defaultMode: "deferred" } as const;
  const deferred = await prepareCommit(patchOf([a]), options(base));
  assertEquals(deferred.rows, []);
  assert(deferred.plan.reindexAfterCommit);
  const explicit = await prepareCommit(
    patchOf([a]),
    options({ ...base, searchIndexOnImport: "incremental" }),
  );
  assertEquals(rowIds(explicit.rows), ids([a]));
});

Deno.test("prepareCommit - a deferred import skips projection but still finds novel quads", async () => {
  const result = await prepareCommit(
    patchOf([a, b]),
    options({ searchIndexOnImport: "deferred", context: merge }, [a]),
  );
  assertEquals(result.rows, []);
  assertEquals(result.novel.novelInsertions, [b]);
  assertEquals(result.plan, {
    projectDuringCommit: false,
    reindexAfterCommit: true,
  });
  const ordinary = await prepareCommit(
    patchOf([b]),
    options({ searchIndexOnImport: "deferred" }),
  );
  assertEquals(rowIds(ordinary.rows), ids([b]));
  assertEquals(ordinary.plan.reindexAfterCommit, false);
});

Deno.test("prepareCommit - disabled mode projects nothing and never reindexes", async () => {
  const result = await prepareCommit(
    patchOf([a]),
    options({ searchIndexOnImport: "disabled" }),
  );
  assertEquals(result.rows, []);
  assertEquals(result.novel.novelInsertions, [a]);
  assertEquals(result.plan.reindexAfterCommit, false);
});

Deno.test("prepareCommit - no projection means no rows", async () => {
  const result = await prepareCommit(
    patchOf([a]),
    options({ projection: undefined }),
  );
  assertEquals(result.rows, []);
  assertEquals(result.novel.novelInsertions, [a]);
});

Deno.test("prepareCommit - the filter drops quads from storage and projection", async () => {
  const result = await prepareCommit(
    patchOf([a, b], [c, b]),
    options({ exclude: { subjects: ["urn:b"] } }),
  );
  assertEquals(result.prepared.insertions, [a]);
  assertEquals(result.prepared.deletions, [c]);
  assertEquals(result.prepared.deletionIds, ids([c]));
  assertEquals(result.novel.novelInsertions, [a]);
  assertEquals(rowIds(result.rows), ids([a]));
});

Deno.test("prepareCommit - a quad deleted and re-added is novel even when stored", async () => {
  const result = await prepareCommit(
    patchOf([a, b], [a]),
    options({}, [a, b]),
  );
  assertEquals(result.novel.novelInsertions, [a]);
  assertEquals(rowIds(result.rows), ids([a]));
  assertEquals(result.prepared.deletionIds, ids([a]));
});

Deno.test("prepareCommit - a replace import ignores stored quads and skips the lookup", async () => {
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
  assert(result.replacing);
  assertEquals(lookups, 0);
  assertEquals(result.novel.novelInsertions, [a, b]);
  assertEquals(rowIds(result.rows), ids([a, b]));
});

Deno.test("prepareCommit - keyOf feeds the lookup and the novel check", async () => {
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
  assertEquals(seen, [["urn:a", "urn:b"]]);
  assertEquals(result.novel.novelInsertions, [b]);
});

Deno.test("prepareCommit - when-projecting selects novel quads only to project them", async () => {
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
  assertEquals(off.novel.novelInsertions, []);
  assertEquals(bare.novel.novelInsertions, []);
  assertEquals(lookups, 0);
  const on = await prepareCommit(patchOf([a]), options(counting));
  assertEquals(lookups, 1);
  assertEquals(on.novel.novelInsertions, [a]);
});

Deno.test("prepareCommit - embeds only the novel texts and attaches vectors", async () => {
  const calls: string[][] = [];
  const result = await prepareCommit(
    patchOf([a, b]),
    options({
      projection: {
        textSplitter: wholeLiteral,
        embeddingService: embedder(calls),
      },
    }, [a]),
  );
  assertEquals(calls, [["b"]]);
  assertEquals(result.rows[0]?.vector, [1, 2]);
});

Deno.test("prepareCommit - an embedding failure rejects before returning", async () => {
  const failing: EmbeddingService = {
    embed: () => Promise.reject(new Error("embedding service down")),
  };
  await assertRejects(
    () =>
      prepareCommit(
        patchOf([a]),
        options({
          projection: {
            textSplitter: wholeLiteral,
            embeddingService: failing,
          },
        }),
      ),
    Error,
    "failed to vectorize literal chunk blocks",
  );
});
