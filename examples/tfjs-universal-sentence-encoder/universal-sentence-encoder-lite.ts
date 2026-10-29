import "@tensorflow/tfjs-backend-wasm";
import * as tf from "@tensorflow/tfjs";
import type { GraphModel } from "@tensorflow/tfjs";
import { loadVocabulary, Tokenizer } from "./tokenizer/mod.ts";

/** BASE_PATH is the default remote path for USE lite vocabulary. */
const BASE_PATH =
  "https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder";

/** DEFAULT_MODEL_URL is the default remote URL for the USE lite graph model. */
const DEFAULT_MODEL_URL =
  "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1";

/** UniversalSentenceEncoderLoadConfig provides optional model and vocabulary URLs. */
export interface UniversalSentenceEncoderLoadConfig {
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
export class UniversalSentenceEncoderLite {
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
