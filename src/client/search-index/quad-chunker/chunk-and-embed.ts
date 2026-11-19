import type * as rdfjs from "@rdfjs/types";
import type { EmbeddingService } from "../embedding-service/embedding-service.ts";
import {
  chunkQuads,
  type ChunkRowPayload,
  type TextSplitterInterface,
} from "./chunk-quads.ts";

/** EmbeddedChunk is a chunk row ready to write, with its vector when one was computed. */
export interface EmbeddedChunk {
  /** chunk is the chunk row payload from chunkQuads. */
  chunk: ChunkRowPayload;

  /** ftsValue is the text the keyword index stores; today the chunk's own text. */
  ftsValue: string;

  /** vector is the embedding of `ftsValue`, absent when none was computed. */
  vector?: Float32Array | number[];
}

/** ChunkAndEmbedOptions configures chunking and the optional embedding pass. */
export interface ChunkAndEmbedOptions {
  /** textSplitter slices long literals into chunks. */
  textSplitter: TextSplitterInterface;

  /** embeddingService computes vectors; without one, rows carry no vectors. */
  embeddingService?: EmbeddingService;

  /**
   * ftsValueOf derives the keyword-index text (and the text that is embedded)
   * from a chunk. Defaults to the chunk's own text, which is what the SQL
   * backends store; `@worlds/indexeddb` lowercases it.
   */
  ftsValueOf?: (chunk: ChunkRowPayload) => string;

  /** vectorDimensions rejects an embedding of any other length. Unchecked when omitted. */
  vectorDimensions?: number;

  /**
   * onEmbeddingFailure picks what an embedding error does. "throw" (default)
   * rejects before the caller writes anything. "degrade" returns the rows
   * without vectors plus `embeddingError`, for backends that store keyword-only
   * chunks and repair vectors on reindex.
   */
  onEmbeddingFailure?: "throw" | "degrade";
}

/** ChunkAndEmbedResult is what a backend writes for a set of novel quads. */
export interface ChunkAndEmbedResult {
  /** rows are the chunk rows to write; empty when no quad has textual content. */
  rows: EmbeddedChunk[];

  /** embeddingError is set only when `onEmbeddingFailure` is "degrade" and embedding failed. */
  embeddingError?: unknown;
}

/**
 * chunkAndEmbedQuads chunks the textual literals of `quads` and embeds them,
 * entirely before the caller opens a write. Chunking and embedding call out to
 * a splitter and an external service, so doing them first means a failure
 * writes nothing. The embedding call receives the de-duplicated chunk texts, as
 * in `@worlds/libsql`, the reference backend.
 */
export async function chunkAndEmbedQuads(
  quads: rdfjs.Quad[],
  quadIds: string[],
  options: ChunkAndEmbedOptions,
): Promise<ChunkAndEmbedResult> {
  let chunks: ChunkRowPayload[];
  try {
    chunks = await chunkQuads(quads, options.textSplitter, quadIds);
  } catch (cause) {
    throw new Error("failed to chunk novel textual facts", { cause });
  }
  const rows: EmbeddedChunk[] = chunks.map((chunk) => ({
    chunk,
    ftsValue: options.ftsValueOf?.(chunk) ?? chunk.value,
  }));
  if (rows.length === 0 || !options.embeddingService) return { rows };

  try {
    const vectors = await embedUnique(rows, options);
    return {
      rows: rows.map((row) => ({ ...row, vector: vectors.get(row.ftsValue) })),
    };
  } catch (cause) {
    if (options.onEmbeddingFailure === "degrade") {
      return { rows, embeddingError: cause };
    }
    throw new Error("failed to vectorize literal chunk blocks", { cause });
  }
}

async function embedUnique(
  rows: EmbeddedChunk[],
  options: ChunkAndEmbedOptions,
): Promise<Map<string, Float32Array | number[]>> {
  const texts = [
    ...new Set(rows.flatMap(({ chunk, ftsValue }) => [ftsValue, chunk.value])),
  ];
  const vectors = await options.embeddingService!.embed(texts);
  for (const vector of vectors) {
    if (
      options.vectorDimensions !== undefined &&
      vector.length !== options.vectorDimensions
    ) {
      throw new Error(
        `embedding length ${vector.length} does not match configured vectorDimensions ${options.vectorDimensions}`,
      );
    }
  }
  return new Map(texts.map((text, i) => [text, vectors[i]!]));
}
