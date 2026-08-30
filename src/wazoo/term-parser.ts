import type * as rdfjs from "@rdfjs/types";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

const LITERAL_RE = /^"(.*)"(?:\^\^(<.*>))?(@.*)?$/;

/**
 * parseNQuadsTerm converts an N-Quads-serialized string (IRI, blank node,
 * or literal) into an RDF/JS term. Used by both the remote quad store and
 * the remote SPARQL engine when the API returns N-Quads string values.
 */
export function parseNQuadsTerm(value: string): rdfjs.Term {
  if (value.startsWith("_:")) {
    return { termType: "BlankNode", value: value.slice(2) } as rdfjs.Term;
  }

  if (value.startsWith('"')) {
    const match = value.match(LITERAL_RE);
    if (match) {
      const [, lexical, datatype, lang] = match;
      if (lang) {
        return {
          termType: "Literal",
          value: lexical,
          language: lang.slice(1),
          datatype: { termType: "NamedNode", value: XSD_STRING },
        } as rdfjs.Term;
      }
      if (datatype) {
        return {
          termType: "Literal",
          value: lexical,
          language: "",
          datatype: { termType: "NamedNode", value: datatype.slice(1, -1) },
        } as rdfjs.Term;
      }
      return {
        termType: "Literal",
        value: lexical,
        language: "",
        datatype: { termType: "NamedNode", value: XSD_STRING },
      } as rdfjs.Term;
    }
  }

  return { termType: "NamedNode", value } as rdfjs.Term;
}
