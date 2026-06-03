import { assertEquals } from "@std/assert";
import { MockEmbeddingModelV3 } from "ai/test";
import { AiSdkEmbeddingService } from "./ai-sdk-embedding-service.ts";

Deno.test("AiSdkEmbeddingService.embed - generates mock embeddings correctly", async () => {
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

  assertEquals(result, [
    [0, 1],
    [1, 2],
  ]);
});

Deno.test("AiSdkEmbeddingService.embed - returns empty array on empty input", async () => {
  const mockModel = new MockEmbeddingModelV3({
    doEmbed: () =>
      Promise.resolve({
        embeddings: [],
        usage: { tokens: 0 },
        warnings: [],
      }),
  });

  const service = new AiSdkEmbeddingService({ model: mockModel });
  const result = await service.embed([]);

  assertEquals(result, []);
});
