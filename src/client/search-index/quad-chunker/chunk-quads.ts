import type { Quad } from "@rdfjs/types";
import { hashQuad, isTextualLiteral } from "@/client/quad-store/mod.ts";

/**
 * ChunkRowPayload is the standardized structure of data that will be inserted into the FTS table.
 */
export interface ChunkRowPayload {
  /** quad_id is the unique canonical identifier of the originating triple. */
  quad_id: string;
  subject: string;
  predicate: string;
  graph: string;
  value: string;
}

/**
 * Document represents the standard structure expected from LangChain splitters, allowing batch operations.
 */
export interface Document {
  pageContent: string;
  metadata?: Record<string, unknown>;
}

/**
 * TextSplitterInterface defines the generic contract for slicing large strings into smaller chunks.
 *
 * @remarks Compatible with the Langchain TextSplitter interface.
 * @see https://docs.langchain.com/oss/javascript/integrations/splitters
 */
export interface TextSplitterInterface {
  createDocuments(
    texts: string[],
    metadatas?: Record<string, unknown>[],
  ): Promise<Document[]>;
}

/**
 * chunkQuads filters literal payload candidates from a collection of RDF Quads
 * and splits large text nodes into smaller semantic substrings ready for vector insertion.
 *
 * @param quads The source triples gathered from recent mutation streams.
 * @param textSplitter The configuration carrying splitting engines and thresholds.
 * @param preComputedIds Optional pre-hashed canonical IDs avoiding CPU duplication.
 * @returns Aggregated list of storage artifacts preserving parent metadata context.
 */
export async function chunkQuads(
  quads: Quad[],
  textSplitter: TextSplitterInterface,
  preComputedIds?: string[],
): Promise<ChunkRowPayload[]> {
  // Filter valid candidates from the stream using the centralized domain validator
  const candidates = quads.filter((quad) => isTextualLiteral(quad.object));

  if (candidates.length === 0) {
    return [];
  }

  // Build id map from preComputedIds (parallel to quads) or compute on demand
  let idByQuad: Map<Quad, string>;
  if (preComputedIds) {
    idByQuad = new Map();
    for (let i = 0; i < quads.length; i++) {
      idByQuad.set(quads[i], preComputedIds[i]);
    }
  } else {
    idByQuad = new Map();
    for (const quad of candidates) {
      idByQuad.set(quad, hashQuad(quad));
    }
  }

  // Prepare batched components and associated correlation vectors.
  const texts = candidates.map((quad) => quad.object.value);
  const metadatas = candidates.map((quad) => ({
    quad_id: idByQuad.get(quad)!,
    subject: quad.subject.value,
    predicate: quad.predicate.value,
    graph: quad.graph.value,
  }));

  // Execute collective chunking via engine injection.
  const docs = await textSplitter.createDocuments(texts, metadatas);

  // Map document partitions back to unified standard storage output.
  return docs.map((doc) => ({
    quad_id: String(doc.metadata?.quad_id ?? ""),
    subject: String(doc.metadata?.subject ?? ""),
    predicate: String(doc.metadata?.predicate ?? ""),
    graph: String(doc.metadata?.graph ?? ""),
    value: doc.pageContent,
  }));
}
