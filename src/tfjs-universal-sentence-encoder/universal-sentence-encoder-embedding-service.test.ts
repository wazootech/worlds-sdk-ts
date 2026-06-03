import { assertEquals } from "@std/assert";
import { UniversalSentenceEncoderEmbeddingService } from "./universal-sentence-encoder-embedding-service.ts";

/** hasLocalModels is true when adapter-local USE artifacts are present on disk. */
function hasLocalModels(): boolean {
  try {
    Deno.statSync(new URL("./models/model.json", import.meta.url));
    Deno.statSync(new URL("./models/vocab.json", import.meta.url));
    return true;
  } catch {
    return false;
  }
}

Deno.test(
  "UniversalSentenceEncoderEmbeddingService.embed - returns empty array for empty input without loading model",
  async () => {
    const embeddingService = new UniversalSentenceEncoderEmbeddingService();
    const vectors = await embeddingService.embed([]);

    assertEquals(vectors, []);
  },
);

/**
 * Requires local model artifacts from `deno task download:tfjs-use`.
 * CI skips when `./models/` is absent (gitignored).
 */
Deno.test({
  name:
    "UniversalSentenceEncoderEmbeddingService.embed - returns 512-d vectors when local models exist",
  ignore: !hasLocalModels(),
  async fn() {
    const embeddingService = new UniversalSentenceEncoderEmbeddingService();
    const vectors = await embeddingService.embed(["hello"]);

    assertEquals(vectors.length, 1);
    assertEquals(vectors[0].length, 512);
    assertEquals(vectors[0].every((value) => Number.isFinite(value)), true);
  },
});
