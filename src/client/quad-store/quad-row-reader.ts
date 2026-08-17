import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@wazoo/sparql-engine";
import { toRdfjsTerm } from "@/client/quad-store/term.ts";

const { quad } = DataFactory;

/**
 * QuadRowReader provides typed accessors for quads table column values from any backend driver row.
 */
export interface QuadRowReader {
  /** s is the subject IRI or blank node label. */
  s: string;

  /** sType is the subject term type ("NamedNode" or "BlankNode"). */
  sType: string;

  /** p is the predicate IRI. */
  p: string;

  /** o is the object lexical value. */
  o: string;

  /** oType is the object term type ("NamedNode", "BlankNode", or "Literal"). */
  oType: string;

  /** oDatatype is the object datatype IRI for typed literals, or null. */
  oDatatype: string | null;

  /** oLang is the object language tag for language-tagged strings, or null. */
  oLang: string | null;

  /** g is the graph IRI or term value. */
  g: string;

  /** gType is the graph term type ("NamedNode" or "DefaultGraph"). */
  gType: string;
}

/**
 * quadFromRow reconstructs an RDF/JS quad from a QuadRowReader impl, eliminating per-backend row mapping duplication.
 */
export function quadFromRow(row: QuadRowReader): rdfjs.Quad {
  const subject = toRdfjsTerm({
    termType: row.sType,
    value: row.s,
  }) as rdfjs.Quad_Subject;
  const predicate = toRdfjsTerm({
    termType: "NamedNode",
    value: row.p,
  }) as rdfjs.Quad_Predicate;
  const object = toRdfjsTerm({
    termType: row.oType,
    value: row.o,
    language: row.oLang ?? undefined,
    datatype: row.oDatatype ?? undefined,
  }) as rdfjs.Quad_Object;
  const graph = toRdfjsTerm({
    termType: row.gType,
    value: row.g,
  }) as rdfjs.Quad_Graph;

  return quad(subject, predicate, object, graph);
}
