import { expect, test } from "bun:test";
import { MockEmbeddingModelV3 } from "ai/test";
import { AiSdkEmbeddingService } from "./ai-sdk-embedding-service.ts";

test("AiSdkEmbeddingService.embed - generates mock embeddings correctly", async () => {
  const mockModel = new MockEmbeddingModelV3({
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => value === "first" ? [0, 1] : [1, 2]),
        usage: { tokens: 10 },
        warnings: [],
      }),
  });

  const service = new AiSdkEmbeddingService({ model: mockModel });
  const result = await service.embed(["first", "second"]);

  expect(result).toStrictEqual([
    [0, 1],
    [1, 2],
  ]);
});

test("AiSdkEmbeddingService.embed - returns empty array on empty input", async () => {
  const service = new AiSdkEmbeddingService({ model: null! });
  const result = await service.embed([]);

  expect(result).toStrictEqual([]);
});
