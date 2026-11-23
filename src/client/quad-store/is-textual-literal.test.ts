import { expect, test } from "bun:test";
import { DataFactory } from "n3";
import { isTextualLiteral } from "./is-textual-literal.ts";

const { literal, namedNode } = DataFactory;

test("isTextualLiteral - evaluates physical string and language variations correctly", () => {
  // 1. Untyped / Default Literal
  expect(isTextualLiteral(literal("hello world"))).toStrictEqual(true);

  // 2. Explicit xsd:string
  expect(isTextualLiteral(
      literal("explicit", namedNode("http://www.w3.org/2001/XMLSchema#string")),
    )).toStrictEqual(true);

  // 3. Explicit rdf:langString
  expect(isTextualLiteral(literal("bonjour", "fr"))).toStrictEqual(true);
});

test("isTextualLiteral - rejects non-literal physical node terms", () => {
  expect(isTextualLiteral(namedNode("urn:subject"))).toStrictEqual(false);
});

test("isTextualLiteral - strictly suppresses structured numeric and boolean primitives", () => {
  // 1. Integer
  expect(isTextualLiteral(
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    )).toStrictEqual(false);

  // 2. Boolean
  expect(isTextualLiteral(
      literal("true", namedNode("http://www.w3.org/2001/XMLSchema#boolean")),
    )).toStrictEqual(false);

  // 3. DateTime
  expect(isTextualLiteral(
      literal(
        "2026-05-12T12:00:00Z",
        namedNode("http://www.w3.org/2001/XMLSchema#dateTime"),
      ),
    )).toStrictEqual(false);
});
