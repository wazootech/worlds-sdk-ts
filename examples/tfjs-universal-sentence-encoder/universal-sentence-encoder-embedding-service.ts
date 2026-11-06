import * as tf from "@tensorflow/tfjs";
import { isAbsolute, toFileUrl } from "@std/path";
import {
  UniversalSentenceEncoderLite,
  type UniversalSentenceEncoderLoadConfig,
} from "./universal-sentence-encoder-lite.ts";

/** UniversalSentenceEncoderEmbeddingServiceOptions defines the configuration for local or remote model resources. */
export interface UniversalSentenceEncoderEmbeddingServiceOptions {
  /** modelUrl is the custom URL or local file path to the model.json file. */
  modelUrl?: string;

  /** vocabUrl is the custom URL or local file path to the vocab.json file. */
  vocabUrl?: string;
}

/** UniversalSentenceEncoderEmbeddingService provides 512-dimensional text embeddings using TensorFlow.js. */
export class UniversalSentenceEncoderEmbeddingService {
  private modelPromise: Promise<UniversalSentenceEncoderLite> | null = null;

  public constructor(
    private readonly options: UniversalSentenceEncoderEmbeddingServiceOptions =
      {},
  ) {
    // Initialize backend immediately
    tf.setBackend("wasm").catch(console.error);
  }

  private resolveModelResourcePath(pathOrUrl: string): string {
    if (
      pathOrUrl.startsWith("http://") ||
      pathOrUrl.startsWith("https://") ||
      pathOrUrl.startsWith("file://")
    ) {
      return pathOrUrl;
    }

    if (isAbsolute(pathOrUrl)) {
      return toFileUrl(pathOrUrl).toString();
    }

    try {
      return toFileUrl(Deno.realPathSync(pathOrUrl)).toString();
    } catch {
      return pathOrUrl;
    }
  }

  private async getModel(): Promise<UniversalSentenceEncoderLite> {
    if (!this.modelPromise) {
      console.log("Loading TensorFlow USE model...");
      const config: UniversalSentenceEncoderLoadConfig = {};

      let modelUrl = this.options.modelUrl;
      let vocabUrl = this.options.vocabUrl;

      // Auto-detect adapter-local model artifacts if not explicitly provided
      if (!modelUrl && !vocabUrl) {
        try {
          const localModelUrl = new URL("./models/model.json", import.meta.url);
          const localVocabUrl = new URL("./models/vocab.json", import.meta.url);

          Deno.statSync(localModelUrl);
          Deno.statSync(localVocabUrl);
          modelUrl = localModelUrl.href;
          vocabUrl = localVocabUrl.href;
          console.log(
            "[UniversalSentenceEncoderEmbeddingService] Auto-detected adapter-local model artifacts.",
          );
        } catch {
          console.warn(
            "[UniversalSentenceEncoderEmbeddingService] Adapter-local model artifacts not found. Defaulting to online download.",
          );
        }
      }

      if (modelUrl) {
        config.modelUrl = this.resolveModelResourcePath(modelUrl);
      }
      if (vocabUrl) {
        config.vocabUrl = this.resolveModelResourcePath(vocabUrl);
      }

      console.log(`[UniversalSentenceEncoderEmbeddingService] config=`, config);
      const model = new UniversalSentenceEncoderLite();
      this.modelPromise = model.load(config).then(() => model);
      await this.modelPromise;
      console.log("Model loaded.");
      return model;
    }
    return this.modelPromise;
  }

  /** embed converts text segments into 512-dimensional vector arrays. */
  public async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const model = await this.getModel();
    const tensor = await model.embed(texts);
    const data = await tensor.data();
    tensor.dispose();

    // The data is a flattened Float32Array. We need to split it into chunks of 512.
    const dimensions = 512;
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const slice = data.slice(i * dimensions, (i + 1) * dimensions);
      result.push(Array.from(slice));
    }
    return result;
  }
}
