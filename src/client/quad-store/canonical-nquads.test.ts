import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { serializeQuadToCanonicalNQuads } from "./canonical-nquads.ts";

const { namedNode, literal, quad, blankNode } = DataFactory;

const s = namedNode("http://example.org/s");
const p = namedNode("http://example.org/p");
const XSD = "http://www.w3.org/2001/XMLSchema#";

Deno.test("serializes default-graph quads to RDFC-1.0 canonical N-Quads", () => {
  // plain xsd:string literal omits the datatype
  assertEquals(
    serializeQuadToCanonicalNQuads(quad(s, p, literal("hello"))),
    '<http://example.org/s> <http://example.org/p> "hello" .\n',
  );
  // explicit xsd:string is normalized to the plain form
  assertEquals(
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal("hi", namedNode(XSD + "string"))),
    ),
    '<http://example.org/s> <http://example.org/p> "hi" .\n',
  );
  // language-tagged literal
  assertEquals(
    serializeQuadToCanonicalNQuads(quad(s, p, literal("bonjour", "fr"))),
    '<http://example.org/s> <http://example.org/p> "bonjour"@fr .\n',
  );
  // non-string datatypes keep their datatype IRI
  assertEquals(
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal("42", namedNode(XSD + "integer"))),
    ),
    "<http://example.org/s> <http://example.org/p> " +
      '"42"^^<http://www.w3.org/2001/XMLSchema#integer> .\n',
  );
});

Deno.test("serializes named graphs and blank nodes", () => {
  assertEquals(
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal("hello"), namedNode("http://example.org/g")),
    ),
    '<http://example.org/s> <http://example.org/p> "hello" ' +
      "<http://example.org/g> .\n",
  );
  // blank-node labels are dataset-local and emitted as-is (label-based scheme)
  assertEquals(
    serializeQuadToCanonicalNQuads(quad(blankNode("b0"), p, literal("hello"))),
    '_:b0 <http://example.org/p> "hello" .\n',
  );
});

Deno.test("escapes literal values per the N-Quads grammar", () => {
  // value: a"b\c + newline + d + tab + e + \u0001 + \u007f
  assertEquals(
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal('a"b\\c\nd\te\u0001\u007f')),
    ),
    // byte-identical to rdf-canonize (RDFC-1.0) output for this literal
    "<http://example.org/s> <http://example.org/p> " +
      '"a\\"b\\\\c\\nd\\te\\u0001\\u007F" .\n',
  );
});

Deno.test("escaping keeps distinct literal values distinct", () => {
  // a quote inside the value cannot be confused with the literal delimiter
  assertNotEquals(
    serializeQuadToCanonicalNQuads(quad(s, p, literal('a"b'))),
    serializeQuadToCanonicalNQuads(quad(s, p, literal("a", "b"))),
  );
  // escape sequences are unambiguous
  assertNotEquals(
    serializeQuadToCanonicalNQuads(quad(s, p, literal("a\nb"))),
    serializeQuadToCanonicalNQuads(quad(s, p, literal("anb"))),
  );
});

Deno.test("serializes RDF 1.2 directional literals", () => {
  const dirLiteral = {
    termType: "Literal",
    value: "مرحبا",
    language: "ar",
    direction: "rtl",
    datatype: namedNode(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
    ),
  } as unknown as rdfjs.Literal;
  assertEquals(
    serializeQuadToCanonicalNQuads(quad(s, p, dirLiteral)),
    '<http://example.org/s> <http://example.org/p> "مرحبا"@ar--rtl .\n',
  );
});

Deno.test("rejects RDF-star triple terms and variables", () => {
  assertThrows(() =>
    serializeQuadToCanonicalNQuads(
      quad(quad(s, p, literal("x")), p, literal("o")),
    )
  );
  assertThrows(() =>
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal("o"), DataFactory.variable("g")),
    )
  );
});
