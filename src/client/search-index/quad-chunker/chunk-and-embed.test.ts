import { assertEquals, assertRejects } from "@std/assert";
import { DataFactory } from "n3";
import { hashQuad } from "@/client/quad-store/mod.ts";
import type { EmbeddingService } from "../embedding-service/embedding-service.ts";
import { chunkAndEmbedQuads } from "./chunk-and-embed.ts";
import type { TextSplitterInterface } from "./chunk-quads.ts";

const { quad, namedNode, literal } = DataFactory;
const g = namedNode("urn:g");
const text = quad(namedNode("urn:a"), namedNode("urn:p"), literal("hello"), g);
const text2 = quad(namedNode("urn:b"), namedNode("urn:p"), literal("hello"), g);
const iri = quad(namedNode("urn:c"), namedNode("urn:p"), namedNode("urn:x"), g);

const splitter: TextSplitterInterface = {
  createDocuments: (texts, metadatas) =>
    Promise.resolve(
      texts.map((pageContent, i) => ({
        pageContent,
        metadata: metadatas?.[i],
      })),
    ),
};
const vectorsOf = (length: number): EmbeddingService => ({
  embed: (texts) => Promise.resolve(texts.map(() => new Float32Array(length))),
});
const failing: EmbeddingService = {
  embed: () => Promise.reject(new Error("quota")),
};
const ids = (quads: Array<typeof text>) => quads.map(hashQuad);

Deno.test("chunkAndEmbedQuads - no textual literals yields no rows and no embedding call", async () => {
  let calls = 0;
  const embeddingService: EmbeddingService = {
    embed: (texts) => {
      calls++;
      return vectorsOf(2).embed(texts);
    },
  };
  const result = await chunkAndEmbedQuads([iri], ids([iri]), {
    textSplitter: splitter,
    embeddingService,
  });
  assertEquals(result.rows, []);
  assertEquals(calls, 0);
});

Deno.test("chunkAndEmbedQuads - without an embedding service rows carry no vectors", async () => {
  const { rows } = await chunkAndEmbedQuads([text], ids([text]), {
    textSplitter: splitter,
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.ftsValue, "hello");
  assertEquals(rows[0]!.chunk.quad_id, hashQuad(text));
  assertEquals(rows[0]!.vector, undefined);
});

Deno.test("chunkAndEmbedQuads - embeds the de-duplicated texts once", async () => {
  const seen: string[][] = [];
  const embeddingService: EmbeddingService = {
    embed: (texts) => {
      seen.push(texts);
      return vectorsOf(2).embed(texts);
    },
  };
  const { rows } = await chunkAndEmbedQuads([text, text2], ids([text, text2]), {
    textSplitter: splitter,
    embeddingService,
    vectorDimensions: 2,
  });
  assertEquals(seen, [["hello"]]);
  assertEquals(rows.map((row) => row.vector?.length), [2, 2]);
});

Deno.test("chunkAndEmbedQuads - a wrong vector length rejects before returning rows", async () => {
  await assertRejects(
    () =>
      chunkAndEmbedQuads([text], ids([text]), {
        textSplitter: splitter,
        embeddingService: vectorsOf(3),
        vectorDimensions: 2,
      }),
    Error,
    "failed to vectorize literal chunk blocks",
  );
});

Deno.test("chunkAndEmbedQuads - an embedding failure throws by default", async () => {
  await assertRejects(
    () =>
      chunkAndEmbedQuads([text], ids([text]), {
        textSplitter: splitter,
        embeddingService: failing,
      }),
    Error,
    "failed to vectorize literal chunk blocks",
  );
});

Deno.test("chunkAndEmbedQuads - degrade keeps the rows without vectors and reports the error", async () => {
  const result = await chunkAndEmbedQuads([text], ids([text]), {
    textSplitter: splitter,
    embeddingService: failing,
    onEmbeddingFailure: "degrade",
  });
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0]!.vector, undefined);
  assertEquals((result.embeddingError as Error).message, "quota");
});

Deno.test("chunkAndEmbedQuads - a failing splitter rejects", async () => {
  await assertRejects(
    () =>
      chunkAndEmbedQuads([text], ids([text]), {
        textSplitter: {
          createDocuments: () => Promise.reject(new Error("bad splitter")),
        },
      }),
    Error,
    "failed to chunk novel textual facts",
  );
});

Deno.test("chunkAndEmbedQuads - ftsValueOf sets the keyword text and the text that is embedded", async () => {
  const seen: string[][] = [];
  const embeddingService: EmbeddingService = {
    embed: (texts) => {
      seen.push(texts);
      return vectorsOf(2).embed(texts);
    },
  };
  const upper = quad(
    namedNode("urn:a"),
    namedNode("urn:p"),
    literal("HeLLo"),
    g,
  );
  const { rows } = await chunkAndEmbedQuads([upper], ids([upper]), {
    textSplitter: splitter,
    embeddingService,
    ftsValueOf: (chunk) => chunk.value.toLowerCase(),
  });
  assertEquals(rows[0]!.ftsValue, "hello");
  assertEquals(rows[0]!.chunk.value, "HeLLo");
  assertEquals(seen, [["hello", "HeLLo"]]);
});
