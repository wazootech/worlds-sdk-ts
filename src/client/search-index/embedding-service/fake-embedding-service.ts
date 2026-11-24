import type { EmbeddingService } from "./embedding-service.ts";

/**
 * FakeEmbeddingService implements a reliable dummy projection model usable
 * during automated integration tests to avoid live API consumption.
 * It constantly outputs valid fixed-dimension Float32 tensors.
 */
export class FakeEmbeddingService implements EmbeddingService {
  /**
   * Construct static deterministic embedding vectors of the required length.
   */
  public embed(texts: string[]): Promise<Array<Float32Array>> {
    // Returns consistent dummy vectors matching our established F32_BLOB(32) shape
    return Promise.resolve(
      texts.map(() => {
        const data = Array.from({ length: 32 }, () => 0);
        data[0] = 1.0; // Stabilized normalized baseline
        return new Float32Array(data);
      }),
    );
  }
}
