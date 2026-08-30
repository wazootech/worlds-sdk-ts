import "@tensorflow/tfjs-backend-wasm";
import * as tf from "@tensorflow/tfjs";
import type { GraphModel } from "@tensorflow/tfjs";
import { isAbsolute, toFileUrl } from "@std/path";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import { loadVocabulary, Tokenizer } from "./tokenizer/mod.ts";

/**
 * BASE_PATH is the default remote path for USE lite vocabulary.
 */
const BASE_PATH =
  "https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder";

/**
 * DEFAULT_MODEL_URL is the default remote URL for the USE lite graph model.
 */
const DEFAULT_MODEL_URL =
  "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1";

/**
 * UniversalSentenceEncoderEmbeddingServiceOptions provides configuration for
 * the TF.js Universal Sentence Encoder embedding service.
 */
export interface UniversalSentenceEncoderEmbeddingServiceOptions {
  /**
   * modelUrl is the custom URL or local file path to the model.json file.
   * Defaults to the TF Hub USE lite model when omitted.
   */
  modelUrl?: string;

  /**
   * vocabUrl is the custom URL or local file path to the vocab.json file.
   * Defaults to the Google Cloud Storage USE vocabulary when omitted.
   */
  vocabUrl?: string;
}

declare interface ModelInputs extends tf.NamedTensorMap {
  indices: tf.Tensor;
  values: tf.Tensor;
}

/**
 * UniversalSentenceEncoderLite loads and runs the USE lite graph model via TF.js.
 */
class UniversalSentenceEncoderLite {
  private model!: GraphModel;
  private tokenizer!: Tokenizer;

  /**
   * loadModel loads the graph model from a URL or TF Hub.
   */
  private loadModel(modelUrl?: string): Promise<GraphModel> {
    return modelUrl
      ? tf.loadGraphModel(modelUrl)
      : tf.loadGraphModel(DEFAULT_MODEL_URL, { fromTFHub: true });
  }

  /**
   * load initializes the graph model and vocabulary tokenizer.
   */
  public async load(
    modelUrl?: string,
    vocabUrl?: string,
  ): Promise<void> {
    const [model, vocabulary] = await Promise.all([
      this.loadModel(modelUrl),
      loadVocabulary(vocabUrl ?? `${BASE_PATH}/vocab.json`),
    ]);

    this.model = model;
    this.tokenizer = new Tokenizer(vocabulary);
  }

  /**
   * embed returns a 2D tensor of shape [input.length, 512] containing USE
   * embeddings.
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

/**
 * resolveModelResourcePath converts a local path or URL string into a file://
 * URL that TF.js can load.
 */
function resolveModelResourcePath(pathOrUrl: string): string {
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

/**
 * UniversalSentenceEncoderEmbeddingService provides 512-dimensional text
 * embeddings using TensorFlow.js Universal Sentence Encoder lite.
 */
export class UniversalSentenceEncoderEmbeddingService
  implements EmbeddingService {
  private modelPromise: Promise<UniversalSentenceEncoderLite> | null = null;

  /**
   * options is the configuration for local or remote model resources.
   */
  public constructor(
    private readonly options: UniversalSentenceEncoderEmbeddingServiceOptions =
      {},
  ) {
    tf.setBackend("wasm").catch(console.error);
  }

  /**
   * getModel lazily loads and caches the underlying USE lite model.
   */
  private async getModel(): Promise<UniversalSentenceEncoderLite> {
    if (!this.modelPromise) {
      const model = new UniversalSentenceEncoderLite();
      const modelUrl = this.options.modelUrl
        ? resolveModelResourcePath(this.options.modelUrl)
        : undefined;
      const vocabUrl = this.options.vocabUrl
        ? resolveModelResourcePath(this.options.vocabUrl)
        : undefined;

      this.modelPromise = model.load(modelUrl, vocabUrl).then(() => model);
      await this.modelPromise;
    }
    return this.modelPromise;
  }

  /**
   * embed converts text segments into 512-dimensional vector arrays.
   *
   * @param texts Array of clean input sequences targeted for vectorizing.
   * @returns Vector space projection arrays matching the input array index positioning.
   */
  public async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const model = await this.getModel();
    const tensor = await model.embed(texts);
    const data = await tensor.data();
    tensor.dispose();

    // The data is a flattened Float32Array. Split into chunks of 512.
    const dimensions = 512;
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const slice = data.slice(i * dimensions, (i + 1) * dimensions);
      result.push(Array.from(slice));
    }
    return result;
  }
}
