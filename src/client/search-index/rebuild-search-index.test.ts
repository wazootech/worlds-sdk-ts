import { assert, assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { hashQuad } from "@/client/quad-store/mod.ts";
import type { EmbeddingService } from "./embedding-service/embedding-service.ts";
import type { TextSplitterInterface } from "./quad-chunker/chunk-quads.ts";
import type { EmbeddedChunk } from "./quad-chunker/chunk-and-embed.ts";
import {
  type ChunkRebuildDriver,
  type RebuildScope,
  rebuildSearchIndex,
} from "./rebuild-search-index.ts";

const { quad, namedNode, literal } = DataFactory;
const make = (name: string) =>
  quad(
    namedNode(`urn:${name}`),
    namedNode("urn:p"),
    literal(name),
    namedNode("urn:g"),
  );
const [a, b, c, d] = ["a", "b", "c", "d"].map(make);
const wholeLiteral: TextSplitterInterface = {
  createDocuments: (texts, metadatas) =>
    Promise.resolve(
      texts.map((pageContent, i) => ({
        pageContent,
        metadata: metadatas?.[i],
      })),
    ),
};
const projection = { textSplitter: wholeLiteral };
const scopeA = { include: { subjects: ["urn:a", "urn:c"] } };

/** FakeDriver holds quads in order, pages them by offset and logs every call. */
class FakeDriver implements ChunkRebuildDriver {
  rows: string[] = ["orphan"];
  log: string[] = [];
  writes: { scope: RebuildScope; rows: number; first: boolean }[] = [];
  pages = 0;
  finish?: () => Promise<void>;

  constructor(private readonly stored: rdfjs.Quad[]) {}

  pageQuads(request: { after?: unknown; pageSize: number }) {
    this.pages++;
    const start = (request.after as number | undefined) ?? 0;
    const end = start + request.pageSize;
    return Promise.resolve({
      quads: this.stored.slice(start, end),
      next: end < this.stored.length ? end : undefined,
    });
  }

  writePage(scope: RebuildScope, rows: EmbeddedChunk[], first: boolean) {
    this.writes.push({ scope, rows: rows.length, first });
    this.log.push("write");
    if ("all" in scope) {
      if (first) this.rows = [];
    } else {
      this.rows = this.rows.filter((id) => !scope.hashes.includes(id));
    }
    this.rows.push(...rows.map((row) => row.chunk.quad_id));
    return Promise.resolve();
  }
}

const withFinish = (driver: FakeDriver): FakeDriver => {
  driver.finish = () => {
    driver.log.push("finish");
    return Promise.resolve();
  };
  return driver;
};

const embedder = (failOnCall: number): EmbeddingService => {
  let calls = 0;
  return {
    embed: (texts) => {
      if (++calls === failOnCall) return Promise.reject(new Error("down"));
      return Promise.resolve(texts.map(() => [1, 2]));
    },
  };
};

Deno.test("rebuildSearchIndex - unscoped clears once, on the first write", async () => {
  const driver = new FakeDriver([a, b, c]);
  const result = await rebuildSearchIndex(driver, projection, { pageSize: 2 });
  assertEquals(result, { processedQuadCount: 3, chunkRowCount: 3 });
  assertEquals(driver.writes.map((w) => w.first), [true, false]);
  assertEquals(driver.writes.every((w) => "all" in w.scope), true);
  assertEquals(driver.rows, [a, b, c].map(hashQuad), "the orphan row is gone");
});

Deno.test("rebuildSearchIndex - scoped clears nothing and replaces only in-scope rows", async () => {
  const driver = new FakeDriver([a, b, c]);
  driver.rows = ["orphan", hashQuad(a), hashQuad(b)];
  const result = await rebuildSearchIndex(driver, projection, {
    pageSize: 10,
    scope: scopeA,
  });
  assertEquals(result, { processedQuadCount: 3, chunkRowCount: 2 });
  assertEquals(driver.writes[0].scope, { hashes: [a, c].map(hashQuad) });
  assertEquals(driver.rows, ["orphan", hashQuad(b), hashQuad(a), hashQuad(c)]);
});

Deno.test("rebuildSearchIndex - a scope with no criteria is unscoped", async () => {
  for (const scope of [{}, { include: {} }, { include: { subjects: [] } }]) {
    const driver = new FakeDriver([a]);
    await rebuildSearchIndex(driver, projection, { pageSize: 5, scope });
    assertEquals(driver.writes, [{
      scope: { all: true },
      rows: 1,
      first: true,
    }]);
    assertEquals(driver.rows, [hashQuad(a)]);
  }
});

Deno.test("rebuildSearchIndex - pages by next cursor and clamps the page size", async () => {
  const driver = new FakeDriver([a, b, c, d]);
  await rebuildSearchIndex(driver, projection, { pageSize: 0 });
  assertEquals(driver.pages, 4, "a page size below 1 reads one quad per page");
  const wide = new FakeDriver([a, b, c, d]);
  await rebuildSearchIndex(wide, projection, { pageSize: 3 });
  assertEquals(wide.pages, 2);
  assertEquals(wide.writes.map((w) => w.rows), [3, 1]);
});

Deno.test("rebuildSearchIndex - counts every scanned quad, in scope or not", async () => {
  const driver = new FakeDriver([a, b, c, d]);
  const result = await rebuildSearchIndex(driver, projection, {
    pageSize: 2,
    scope: { include: { subjects: ["urn:d"] } },
  });
  assertEquals(result, { processedQuadCount: 4, chunkRowCount: 1 });
  assertEquals(
    driver.writes.length,
    1,
    "a page without in-scope quads is skipped",
  );
});

Deno.test("rebuildSearchIndex - an empty store still clears once, unscoped only", async () => {
  const unscoped = new FakeDriver([]);
  const result = await rebuildSearchIndex(unscoped, projection, {
    pageSize: 5,
  });
  assertEquals(result, { processedQuadCount: 0, chunkRowCount: 0 });
  assertEquals(unscoped.writes, [{
    scope: { all: true },
    rows: 0,
    first: true,
  }]);
  assertEquals(unscoped.rows, []);
  const scoped = new FakeDriver([]);
  await rebuildSearchIndex(scoped, projection, { pageSize: 5, scope: scopeA });
  assertEquals(scoped.writes, []);
  assertEquals(scoped.rows, ["orphan"]);
});

Deno.test("rebuildSearchIndex - an embedding failure on page 1 writes nothing", async () => {
  const driver = new FakeDriver([a, b, c]);
  await assertRejects(
    () =>
      rebuildSearchIndex(driver, {
        ...projection,
        embeddingService: embedder(1),
      }, { pageSize: 2 }),
    Error,
    "failed to vectorize",
  );
  assertEquals(driver.writes, []);
  assertEquals(driver.rows, ["orphan"], "the old rows survive");
});

Deno.test("rebuildSearchIndex - a failure on page 2 leaves page 1 written", async () => {
  const driver = withFinish(new FakeDriver([a, b, c]));
  await assertRejects(
    () =>
      rebuildSearchIndex(driver, {
        ...projection,
        embeddingService: embedder(2),
      }, { pageSize: 2 }),
    Error,
    "failed to vectorize",
  );
  assertEquals(driver.writes.length, 1);
  assertEquals(driver.rows, [a, b].map(hashQuad));
  assertEquals(driver.log, ["write"], "finish never runs after a failure");
});

Deno.test("rebuildSearchIndex - finish runs once after every page", async () => {
  const driver = withFinish(new FakeDriver([a, b, c]));
  await rebuildSearchIndex(driver, projection, { pageSize: 1 });
  assertEquals(driver.log, ["write", "write", "write", "finish"]);
});

Deno.test("rebuildSearchIndex - finish is optional", async () => {
  const driver = new FakeDriver([a]);
  assert(driver.finish === undefined);
  assertEquals(
    await rebuildSearchIndex(driver, projection, { pageSize: 1 }),
    { processedQuadCount: 1, chunkRowCount: 1 },
  );
});
