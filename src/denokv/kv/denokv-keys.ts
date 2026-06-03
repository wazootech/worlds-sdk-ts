import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";

const { namedNode } = DataFactory;

/**
 * DenokvHexastoreKeyNamespace is the set of fixed key segments used by the KV quad index layout.
 */
export type DenokvHexastoreKeyNamespace =
  | "idx_spog"
  | "idx_sopg"
  | "idx_psog"
  | "idx_posg"
  | "idx_ospg"
  | "idx_opsg"
  | "idx_gspo";

/**
 * buildGenerationDataPrefix returns the KV prefix for one dataset generation.
 */
export function buildGenerationDataPrefix(
  keyPrefix: Deno.KvKey,
  generationId: number,
): Deno.KvKey {
  return [...keyPrefix, "g", generationId];
}

/**
 * buildPrimaryQuadKey returns the KV key for a persisted quad payload.
 */
export function buildPrimaryQuadKey(
  scopedDataPrefix: Deno.KvKey,
  quadId: string,
): Deno.KvKey {
  return [...scopedDataPrefix, "quads", quadId];
}

/**
 * termKeyParts converts an RDF term into stable KV key parts.
 */
export function termKeyParts(term: rdfjs.Term): Deno.KvKeyPart[] {
  if (term.termType === "Literal") {
    const literalTerm = term as rdfjs.Literal;
    return [
      "Literal",
      literalTerm.value,
      literalTerm.language ?? "",
      literalTerm.datatype?.value ?? "",
    ];
  }

  if (term.termType === "DefaultGraph") {
    return ["DefaultGraph"];
  }

  return [term.termType, term.value];
}

/**
 * normalizeGraphTerm returns an RDFJS Term for graph inputs that accept string IRIs.
 */
export function normalizeGraphTerm(graph: rdfjs.Term | string): rdfjs.Term {
  return typeof graph === "string" ? namedNode(graph) : graph;
}

/**
 * buildIndexKey returns the KV key for a quad index secondary index pointer row.
 */
export function buildIndexKey(
  scopedDataPrefix: Deno.KvKey,
  indexNamespace: DenokvHexastoreKeyNamespace,
  parts: readonly Deno.KvKeyPart[],
  quadId: string,
): Deno.KvKey {
  return [...scopedDataPrefix, indexNamespace, ...parts, quadId];
}
