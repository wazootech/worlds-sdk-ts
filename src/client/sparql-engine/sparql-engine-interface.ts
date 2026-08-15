import type * as rdfjs from "@rdfjs/types";

/**
 * SparqlEngineInterface executes raw SPARQL queries/updates against a data adapter.
 */
export interface SparqlEngineInterface {
  /**
   * execute fires a SPARQL request and returns a strongly typed response.
   *
   * @param request contains the raw query string and execution settings.
   */
  execute(request: SparqlRequest): Promise<SparqlResponse>;
}

/**
 * SparqlRequest is the request type for evaluating SPARQL operations.
 */
export interface SparqlRequest {
  /** The raw SPARQL query string. */
  query?: string;

  /** The raw SPARQL update string. */
  update?: string;

  /** Base IRI for the query execution. */
  baseIri?: string;

  /** Query timeout in milliseconds (defaults to 30 seconds). */
  timeoutMs?: number;
}

/**
 * SparqlResponse is the encapsulated response wrapping typed result packets.
 */
export type SparqlResponse =
  | { kind: "select"; data: SparqlSelectResults }
  | { kind: "ask"; data: SparqlAskResults }
  | { kind: "construct"; data: SparqlConstructResults }
  | { kind: "void" };

/**
 * SparqlAskResults is the specific format for an ASK boolean query.
 */
export interface SparqlAskResults {
  head: {
    link?: Array<string> | null;
  };
  boolean: boolean;
}

/**
 * SparqlSelectResults is the tabular format returned by SELECT queries.
 */
export interface SparqlSelectResults {
  head: {
    vars: Array<string>;
    link?: Array<string> | null;
  };
  results: {
    bindings: Array<SparqlBinding>;
  };
}

/**
 * SparqlConstructResults is the quad stream returned by CONSTRUCT/DESCRIBE queries.
 */
export interface SparqlConstructResults {
  quads: Array<rdfjs.Quad>;
}

/**
 * SparqlValue is a specific value bound to a variable within a SPARQL result
 * binding.
 */
export type SparqlValue =
  | { type: "uri"; value: string }
  | { type: "bnode"; value: string }
  | {
    type: "literal";
    value: string;
    "xml:lang"?: string;
    /** Base direction ("ltr"/"rtl") of an RDF 1.2 directional language-tagged literal, per the SPARQL 1.2 results JSON/XML formats. */
    "its:dir"?: "ltr" | "rtl";
    datatype?: string;
  }
  | {
    type: "triple";
    value: {
      subject: SparqlValue;
      predicate: SparqlValue;
      object: SparqlValue;
    };
  };

/**
 * SparqlBinding is a map associating specific variable identifiers to resolved values.
 */
export type SparqlBinding = Record<string, SparqlValue>;
