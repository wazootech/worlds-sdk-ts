import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@wazoo/sparql-engine";

const { namedNode, blankNode, literal, defaultGraph } = DataFactory;

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** Term is the backend-neutral serializable record for one RDF term. */
export interface Term {
  /** termType is the RDF/JS term type discriminator. */
  termType: string;

  /** value is the lexical or IRI value for the term. */
  value: string;

  /** language is the optional language tag for Literal terms. */
  language?: string;

  /** datatype is the optional datatype IRI for Literal terms. */
  datatype?: string;
}

/**
 * fromRdfjsTerm flattens an RDF/JS term into a backend-neutral Term.
 */
export function fromRdfjsTerm(rdfjsTerm: rdfjs.Term): Term {
  if (rdfjsTerm.termType === "Literal") {
    const literalTerm = rdfjsTerm as rdfjs.Literal;
    return {
      termType: rdfjsTerm.termType,
      value: rdfjsTerm.value,
      language: literalTerm.language || undefined,
      datatype: literalTerm.datatype?.value || undefined,
    };
  }

  return {
    termType: rdfjsTerm.termType,
    value: rdfjsTerm.value,
  };
}

/**
 * toRdfjsTerm reconstitutes an RDF/JS term from a backend-neutral Term.
 */
export function toRdfjsTerm(storedTerm: Term): rdfjs.Term {
  switch (storedTerm.termType) {
    case "NamedNode":
      return namedNode(storedTerm.value);
    case "BlankNode":
      return blankNode(storedTerm.value);
    case "Literal": {
      if (storedTerm.language && storedTerm.language.trim().length > 0) {
        return literal(storedTerm.value, storedTerm.language);
      }
      if (storedTerm.datatype && storedTerm.datatype !== XSD_STRING) {
        return literal(storedTerm.value, namedNode(storedTerm.datatype));
      }
      return literal(storedTerm.value);
    }
    case "DefaultGraph":
      return defaultGraph();
    default:
      throw new Error(`Unsupported term type: ${storedTerm.termType}`);
  }
}
