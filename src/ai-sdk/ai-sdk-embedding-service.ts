import { embedMany } from "ai";
import type { EmbeddingModel } from "ai";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";

/**
 * AiSdkEmbeddingServiceOptions provides configurations for the AI SDK embedding service.
 */
export interface AiSdkEmbeddingServiceOptions {
  /** model is the Vercel AI SDK embedding model instance. */
  model: EmbeddingModel;

  /** maxRetries is the optional maximum number of retries for embedding requests. */
  maxRetries?: number;

  /** abortSignal is the optional signal to cancel request execution. */
  abortSignal?: AbortSignal;
}

/**
 * AiSdkEmbeddingService provides text embedding generation leveraging Vercel AI SDK's embedMany.
 */
export class AiSdkEmbeddingService implements EmbeddingService {
  public constructor(
    private readonly options: AiSdkEmbeddingServiceOptions,
  ) {}

  /**
   * embed converts text sequences into high-dimensional vector arrays using Vercel AI SDK.
   *
   * @param texts Array of clean input sequences targeted for vectorizing.
   * @returns Vector space projection arrays matching the input array index positioning.
   */
  public async embed(texts: string[]): Promise<Array<Float32Array | number[]>> {
    if (texts.length === 0) {
      return [];
    }

    const { embeddings } = await embedMany({
      model: this.options.model,
      values: texts,
      maxRetries: this.options.maxRetries,
      abortSignal: this.options.abortSignal,
    });

    return embeddings;
  }
}
