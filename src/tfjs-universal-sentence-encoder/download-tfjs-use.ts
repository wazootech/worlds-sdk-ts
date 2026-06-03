import { ensureDir } from "@std/fs";

/** TARGET_DIR is the adapter-local models directory resolved from this script's location. */
const TARGET_DIR = new URL("./models/", import.meta.url);

const URLS = [
  {
    name: "model.json",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/model.json?tfjs-format=file",
  },
  {
    name: "vocab.json",
    url:
      "https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder/vocab.json",
  },
  {
    name: "group1-shard1of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard1of7?tfjs-format=file",
  },
  {
    name: "group1-shard2of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard2of7?tfjs-format=file",
  },
  {
    name: "group1-shard3of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard3of7?tfjs-format=file",
  },
  {
    name: "group1-shard4of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard4of7?tfjs-format=file",
  },
  {
    name: "group1-shard5of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard5of7?tfjs-format=file",
  },
  {
    name: "group1-shard6of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard6of7?tfjs-format=file",
  },
  {
    name: "group1-shard7of7",
    url:
      "https://tfhub.dev/tensorflow/tfjs-model/universal-sentence-encoder-lite/1/default/1/group1-shard7of7?tfjs-format=file",
  },
];

async function downloadModels() {
  console.log(`Ensuring target directory exists: ${TARGET_DIR}`);
  await ensureDir(TARGET_DIR);

  for (const { name, url } of URLS) {
    const destUrl = new URL(name, TARGET_DIR);
    console.log(`Downloading ${name} from ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${name}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    await Deno.writeFile(destUrl, new Uint8Array(buffer));
    console.log(`Saved to ${destUrl}`);
  }

  console.log("All model artifacts downloaded successfully.");
}

if (import.meta.main) {
  downloadModels().catch(console.error);
}
