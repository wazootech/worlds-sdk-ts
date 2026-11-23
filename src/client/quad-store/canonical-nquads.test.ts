import { expect, test } from "bun:test";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { serializeQuadToCanonicalNQuads } from "./canonical-nquads.ts";

const { namedNode, literal, quad, blankNode } = DataFactory;

const s = namedNode("http://example.org/s");
const p = namedNode("http://example.org/p");
const XSD = "http://www.w3.org/2001/XMLSchema#";

test("serializes default-graph quads to RDFC-1.0 canonical N-Quads", () => {
  // plain xsd:string literal omits the datatype
  expect(serializeQuadToCanonicalNQuads(quad(s, p, literal("hello")))).toStrictEqual('<http://example.org/s> <http://example.org/p> "hello" .\n');
  // explicit xsd:string is normalized to the plain form
  expect(serializeQuadToCanonicalNQuads(
      quad(s, p, literal("hi", namedNode(XSD + "string"))),
    )).toStrictEqual('<http://example.org/s> <http://example.org/p> "hi" .\n');
  // language-tagged literal
  expect(serializeQuadToCanonicalNQuads(quad(s, p, literal("bonjour", "fr")))).toStrictEqual('<http://example.org/s> <http://example.org/p> "bonjour"@fr .\n');
  // non-string datatypes keep their datatype IRI
  expect(serializeQuadToCanonicalNQuads(
      quad(s, p, literal("42", namedNode(XSD + "integer"))),
    )).toStrictEqual("<http://example.org/s> <http://example.org/p> " +
      '"42"^^<http://www.w3.org/2001/XMLSchema#integer> .\n');
});

test("serializes named graphs and blank nodes", () => {
  expect(serializeQuadToCanonicalNQuads(
      quad(s, p, literal("hello"), namedNode("http://example.org/g")),
    )).toStrictEqual('<http://example.org/s> <http://example.org/p> "hello" ' +
      "<http://example.org/g> .\n");
  // blank-node labels are dataset-local and emitted as-is (label-based scheme)
  expect(serializeQuadToCanonicalNQuads(quad(blankNode("b0"), p, literal("hello")))).toStrictEqual('_:b0 <http://example.org/p> "hello" .\n');
});

test("escapes literal values per the N-Quads grammar", () => {
  // value: a"b\c + newline + d + tab + e + \u0001 + \u007f
  expect(serializeQuadToCanonicalNQuads(
      quad(s, p, literal('a"b\\c\nd\te\u0001\u007f')),
    )).toStrictEqual("<http://example.org/s> <http://example.org/p> " +
      '"a\\"b\\\\c\\nd\\te\\u0001\\u007F" .\n');
});

test("escaping keeps distinct literal values distinct", () => {
  // a quote inside the value cannot be confused with the literal delimiter
  expect(serializeQuadToCanonicalNQuads(quad(s, p, literal('a"b')))).not.toStrictEqual(serializeQuadToCanonicalNQuads(quad(s, p, literal("a", "b"))));
  // escape sequences are unambiguous
  expect(serializeQuadToCanonicalNQuads(quad(s, p, literal("a\nb")))).not.toStrictEqual(serializeQuadToCanonicalNQuads(quad(s, p, literal("anb"))));
});

test("serializes RDF 1.2 directional literals", () => {
  const dirLiteral = {
    termType: "Literal",
    value: "مرحبا",
    language: "ar",
    direction: "rtl",
    datatype: namedNode(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
    ),
  } as unknown as rdfjs.Literal;
  expect(serializeQuadToCanonicalNQuads(quad(s, p, dirLiteral))).toStrictEqual('<http://example.org/s> <http://example.org/p> "مرحبا"@ar--rtl .\n');
});

test("rejects RDF-star triple terms and variables", () => {
  expect(() =>
    serializeQuadToCanonicalNQuads(
      quad(quad(s, p, literal("x")), p, literal("o")),
    )).toThrow();
  expect(() =>
    serializeQuadToCanonicalNQuads(
      quad(s, p, literal("o"), DataFactory.variable("g")),
    )).toThrow();
});
