import type * as rdfjs from "@rdfjs/types";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/**
 * serializeQuadToCanonicalNQuads serializes a single RDF/JS quad to the
 * canonical N-Quads form (RDF 1.1 N-Quads) emitted by RDFC-1.0 dataset
 * canonicalization (rdf-canonize) for blank-node-free quads: one statement
 * terminated by a trailing newline.
 *
 * Canonical literal rules: plain xsd:string literals omit the datatype,
 * language-tagged literals serialize as "..."@lang, RDF 1.2 directional
 * literals as "..."@lang--dir, and every other datatype as "..."^^<iri>.
 *
 * Blank nodes are serialized with their dataset-local label as-is
 * (label-based, like the Statement Hash scheme); this package does not
 * perform RDFC-1.0's dataset-level blank-node relabeling, so quads with
 * blank nodes are NOT byte-identical to RDFC-1.0 output.
 *
 * RDF-star triple terms and variables are rejected — N-Quads has no
 * representation for them.
 */
export function serializeQuadToCanonicalNQuads(quad: rdfjs.Quad): string {
  const subject = serializeTerm(quad.subject, "subject");
  const predicate = serializeTerm(quad.predicate, "predicate");
  const object = serializeTerm(quad.object, "object");
  const graph = quad.graph.termType === "DefaultGraph"
    ? ""
    : serializeTerm(quad.graph, "graph");
  return subject + " " + predicate + " " + object +
    (graph ? " " + graph : "") + " .\n";
}

type QuadPosition = "subject" | "predicate" | "object" | "graph";

function serializeTerm(term: rdfjs.Term, position: QuadPosition): string {
  switch (term.termType) {
    case "NamedNode":
      return "<" + escapeIri(term.value) + ">";
    case "BlankNode":
      return "_:" + term.value;
    case "Literal":
      if (position !== "object") {
        throw new Error(
          "N-Quads cannot serialize a Literal term in " + position +
            " position",
        );
      }
      return serializeLiteral(term as rdfjs.Literal);
    case "Quad":
      throw new Error(
        "N-Quads does not support RDF-star triple terms; refusing to serialize",
      );
    case "Variable":
      throw new Error("N-Quads cannot serialize a Variable term");
    default:
      throw new Error("Unsupported RDF term type: " + term.termType);
  }
}

function serializeLiteral(literal: rdfjs.Literal): string {
  const lexical = '"' + escapeNQuadsString(literal.value) + '"';
  if (literal.language) {
    const direction = literal.direction ? "--" + literal.direction : "";
    return lexical + "@" + literal.language + direction;
  }
  const datatype = literal.datatype?.value ?? XSD_STRING;
  if (datatype === XSD_STRING) {
    return lexical;
  }
  return lexical + "^^<" + escapeIri(datatype) + ">";
}

function escapeNQuadsString(value: string): string {
  let out = "";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        out += code < 0x20 || code === 0x7f ? escapeControlChar(ch) : ch;
      }
    }
  }
  return out;
}

function escapeIri(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\\") {
      out += "\\\\";
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (
      code < 0x20 || code === 0x7f || ch === "<" || ch === ">" ||
      ch === '"' || ch === "{" || ch === "}" || ch === "|" ||
      ch === "^" || ch === "\u0060"
    ) {
      out += escapeControlChar(ch);
    } else {
      out += ch;
    }
  }
  return out;
}

function escapeControlChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0xffff) {
    return "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return "\\U" + code.toString(16).toUpperCase().padStart(8, "0");
}
