import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { hashQuad } from "@/client/quad-store/mod.ts";

const { literal, namedNode, quad: createQuad, defaultGraph } = DataFactory;

/** BuildSearchResultIdOptions supplies the fields used to derive a stable search result id. */
export interface BuildSearchResultIdOptions {
  /** subject is the subject IRI of the matched fact. */
  subject: string;

  /** predicate is the predicate IRI of the matched fact. */
  predicate: string;

  /** graph is the graph IRI, or empty for the default graph. */
  graph: string;

  /** text is the literal value returned as SearchResult.text. */
  text: string;
}

/**
 * buildSearchResultId computes a stable id from the discovery-facing literal text.
 */
export function buildSearchResultId(
  options: BuildSearchResultIdOptions,
): string {
  const searchQuad = createQuad(
    namedNode(options.subject),
    namedNode(options.predicate),
    literal(options.text),
    options.graph ? namedNode(options.graph) : defaultGraph(),
  );

  return hashQuad(searchQuad);
}
