import { expect, test } from "bun:test";
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

test("chunkAndEmbedQuads - no textual literals yields no rows and no embedding call", async () => {
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
  expect(result.rows).toStrictEqual([]);
  expect(calls).toStrictEqual(0);
});

test("chunkAndEmbedQuads - without an embedding service rows carry no vectors", async () => {
  const { rows } = await chunkAndEmbedQuads([text], ids([text]), {
    textSplitter: splitter,
  });
  expect(rows.length).toStrictEqual(1);
  expect(rows[0]!.ftsValue).toStrictEqual("hello");
  expect(rows[0]!.chunk.quad_id).toStrictEqual(hashQuad(text));
  expect(rows[0]!.vector).toStrictEqual(undefined);
});

test("chunkAndEmbedQuads - embeds the de-duplicated texts once", async () => {
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
  expect(seen).toStrictEqual([["hello"]]);
  expect(rows.map((row) => row.vector?.length)).toStrictEqual([2, 2]);
});

test("chunkAndEmbedQuads - a wrong vector length rejects before returning rows", async () => {
  await expect(
    chunkAndEmbedQuads([text], ids([text]), {
      textSplitter: splitter,
      embeddingService: vectorsOf(3),
      vectorDimensions: 2,
    }),
  ).rejects.toThrow("failed to vectorize literal chunk blocks");
});

test("chunkAndEmbedQuads - an embedding failure throws by default", async () => {
  await expect(
    chunkAndEmbedQuads([text], ids([text]), {
      textSplitter: splitter,
      embeddingService: failing,
    }),
  ).rejects.toThrow("failed to vectorize literal chunk blocks");
});

test("chunkAndEmbedQuads - a failing splitter rejects", async () => {
  await expect(
    chunkAndEmbedQuads([text], ids([text]), {
      textSplitter: {
        createDocuments: () => Promise.reject(new Error("bad splitter")),
      },
    }),
  ).rejects.toThrow("failed to chunk novel textual facts");
});

test("chunkAndEmbedQuads - ftsValueOf sets the keyword text and the text that is embedded", async () => {
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
  expect(rows[0]!.ftsValue).toStrictEqual("hello");
  expect(rows[0]!.chunk.value).toStrictEqual("HeLLo");
  expect(seen).toStrictEqual([["hello", "HeLLo"]]);
});
