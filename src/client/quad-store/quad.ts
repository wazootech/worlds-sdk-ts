import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@wazoo/sparql-engine";
import type { Term } from "@/client/quad-store/term.ts";
import { fromRdfjsTerm, toRdfjsTerm } from "@/client/quad-store/term.ts";

const { quad } = DataFactory;

/** Quad is the backend-neutral serializable record for one RDF quad. */
export interface Quad {
  /** subject is the serialized RDF subject term. */
  subject: Term;
  /** predicate is the serialized RDF predicate term. */
  predicate: Term;
  /** object is the serialized RDF object term. */
  object: Term;
  /** graph is the serialized RDF graph term. */
  graph: Term;
}

/**
 * fromRdfjsQuad flattens an RDF/JS quad into a backend-neutral Quad.
 */
export function fromRdfjsQuad(rdfjsQuad: rdfjs.Quad): Quad {
  return {
    subject: fromRdfjsTerm(rdfjsQuad.subject),
    predicate: fromRdfjsTerm(rdfjsQuad.predicate),
    object: fromRdfjsTerm(rdfjsQuad.object),
    graph: fromRdfjsTerm(rdfjsQuad.graph),
  };
}

/**
 * toRdfjsQuad reconstitutes an RDF/JS quad from a backend-neutral Quad.
 */
export function toRdfjsQuad(storedQuad: Quad): rdfjs.Quad {
  return quad(
    toRdfjsTerm(storedQuad.subject) as rdfjs.Quad_Subject,
    toRdfjsTerm(storedQuad.predicate) as rdfjs.Quad_Predicate,
    toRdfjsTerm(storedQuad.object) as rdfjs.Quad_Object,
    toRdfjsTerm(storedQuad.graph) as rdfjs.Quad_Graph,
  );
}
