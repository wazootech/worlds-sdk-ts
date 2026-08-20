import { UniversalSentenceEncoderEmbeddingService } from "./universal-sentence-encoder-embedding-service.ts";

if (import.meta.main) {
  const service = new UniversalSentenceEncoderEmbeddingService();

  const texts = [
    "The quick brown fox jumps over the lazy dog.",
    "TensorFlow.js enables machine learning in the browser.",
    "A persistent knowledge graph for edge-native agents.",
  ];

  console.log(
    `Embedding ${texts.length} text(s) with TF.js Universal Sentence Encoder…`,
  );
  const embeddings = await service.embed(texts);

  for (let i = 0; i < texts.length; i++) {
    const dims = embeddings[i].length;
    const preview = embeddings[i].slice(0, 5).map((v) => v.toFixed(4)).join(
      ", ",
    );
    console.log(`  [${dims}-d] "${texts[i]}" → [${preview}, …]`);
  }
}
