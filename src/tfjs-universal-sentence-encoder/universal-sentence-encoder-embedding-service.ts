import "@tensorflow/tfjs-backend-wasm";
import * as tf from "@tensorflow/tfjs";
import type { GraphModel } from "@tensorflow/tfjs";
import { isAbsolute, toFileUrl } from "@std/path";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import { loadVocabulary, Tokenizer } from "./tokenizer/mod.ts";

/** BASE_PATH is the default remote path for USE lite vocabulary. */
const BASE_PATH =
  "https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder";

/** DEFAULT_MODEL_URL is the default remote URL for the USE lite graph model. */
const DEFAULT_MODEL_URL =
  "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1";

/** UniversalSentenceEncoderLoadConfig provides optional model and vocabulary URLs. */
interface UniversalSentenceEncoderLoadConfig {
  /** modelUrl is the custom URL or local file path to the model.json file. */
  modelUrl?: string;

  /** vocabUrl is the custom URL or local file path to the vocab.json file. */
  vocabUrl?: string;
}

declare interface ModelInputs extends tf.NamedTensorMap {
  indices: tf.Tensor;
  values: tf.Tensor;
}

/** UniversalSentenceEncoderLite loads and runs the USE lite graph model via TF.js 4.x. */
class UniversalSentenceEncoderLite {
  private model!: GraphModel;
  private tokenizer!: Tokenizer;

  /** loadModel loads the graph model from a URL or TF Hub. */
  private loadModel(modelUrl?: string): Promise<GraphModel> {
    return modelUrl
      ? tf.loadGraphModel(modelUrl)
      : tf.loadGraphModel(DEFAULT_MODEL_URL, { fromTFHub: true });
  }

  /** load initializes the graph model and vocabulary tokenizer. */
  public async load(
    config: UniversalSentenceEncoderLoadConfig = {},
  ): Promise<void> {
    const [model, vocabulary] = await Promise.all([
      this.loadModel(config.modelUrl),
      loadVocabulary(config.vocabUrl ?? `${BASE_PATH}/vocab.json`),
    ]);

    this.model = model;
    this.tokenizer = new Tokenizer(vocabulary);
  }

  /**
   * embed returns a 2D tensor of shape [input.length, 512] containing USE embeddings.
   *
   * @param inputs Strings to embed.
   */
  public async embed(inputs: string[]): Promise<tf.Tensor2D> {
    const encodings = inputs.map((text) => this.tokenizer.encode(text));

    const indicesArr = encodings.map((arr, i) =>
      arr.map((_token, index) => [i, index])
    );

    let flattenedIndicesArr: Array<[number, number]> = [];
    for (let i = 0; i < indicesArr.length; i++) {
      flattenedIndicesArr = flattenedIndicesArr.concat(
        indicesArr[i] as Array<[number, number]>,
      );
    }

    const indices = tf.tensor2d(
      flattenedIndicesArr,
      [flattenedIndicesArr.length, 2],
      "int32",
    );
    const values = tf.tensor1d(
      tf.util.flatten(encodings) as number[],
      "int32",
    );

    const modelInputs: ModelInputs = { indices, values };

    const embeddings = await this.model.executeAsync(modelInputs);
    indices.dispose();
    values.dispose();

    return embeddings as tf.Tensor2D;
  }
}

/** UniversalSentenceEncoderEmbeddingServiceOptions defines the configuration for local or remote model resources. */
export interface UniversalSentenceEncoderEmbeddingServiceOptions {
  /** modelUrl is the custom URL or local file path to the model.json file. */
  modelUrl?: string;

  /** vocabUrl is the custom URL or local file path to the vocab.json file. */
  vocabUrl?: string;
}

/** UniversalSentenceEncoderEmbeddingService provides 512-dimensional text embeddings using TensorFlow.js. */
export class UniversalSentenceEncoderEmbeddingService
  implements EmbeddingService {
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
