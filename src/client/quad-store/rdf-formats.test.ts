import { expect, test } from "bun:test";
import { DataFactory, Store } from "n3";
import type * as rdfjs from "@rdfjs/types";
import { parseTurtleQuads, serializeTurtle } from "@wazoo/sparql-engine";
import {
  collectQuadsFromStream,
  exportQuadsResponse,
  FORMATS,
  getFormat,
  materializeImportQuads,
  parseQuads,
} from "./rdf-formats.ts";
import { serializeQuadToCanonicalNQuads } from "./canonical-nquads.ts";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

const XSD = "http://www.w3.org/2001/XMLSchema#";

const fixtureQuads: rdfjs.Quad[] = [
  quad(
    namedNode("urn:alice"),
    namedNode("urn:likes"),
    literal("sailing", "en"),
    defaultGraph(),
  ),
  quad(
    namedNode("urn:alice"),
    namedNode("urn:age"),
    literal("42", namedNode(XSD + "integer")),
    defaultGraph(),
  ),
  quad(
    namedNode("urn:alice"),
    namedNode("urn:posted"),
    literal("alice wrote a public note"),
    namedNode("urn:graph:public"),
  ),
  quad(
    namedNode("urn:alice"),
    namedNode("urn:stores"),
    literal("confidential material"),
    namedNode("urn:graph:private"),
  ),
];

function canonicalSet(quads: Iterable<rdfjs.Quad>): Set<string> {
  return new Set(Array.from(quads, (q) => serializeQuadToCanonicalNQuads(q)));
}

function assertSameQuadSet(
  actual: Iterable<rdfjs.Quad>,
  expected: Iterable<rdfjs.Quad>,
): void {
  expect(canonicalSet(actual)).toStrictEqual(canonicalSet(expected));
}

test("FORMATS maps content types to engine writer formats", () => {
  expect(FORMATS["text/turtle"].engineFormat).toStrictEqual("turtle");
  expect(FORMATS["text/turtle"].contentType).toStrictEqual("text/turtle");
  expect(FORMATS["application/n-quads"].engineFormat).toStrictEqual("n-quads");
  expect(FORMATS["application/n-triples"].engineFormat).toStrictEqual(
    "n-triples",
  );
  expect(FORMATS["text/n3"].engineFormat).toStrictEqual("turtle");
});

test("getFormat defaults to N-Quads and lowercases the content type", () => {
  expect(getFormat(undefined).engineFormat).toStrictEqual("n-quads");
  expect(getFormat("TEXT/TURTLE").engineFormat).toStrictEqual("turtle");
  expect(getFormat("application/unknown").engineFormat).toStrictEqual(
    "n-quads",
  );
});

test("parseQuads + collectQuadsFromStream parse TriG named-graph blocks", async () => {
  const trig =
    '<urn:g1> { <urn:a> <urn:p> "v" . }\n<urn:g2> { <urn:b> <urn:p> "w" . }';

  const quads = await collectQuadsFromStream(parseQuads(trig, "text/turtle"));

  assertSameQuadSet(quads, [
    quad(
      namedNode("urn:a"),
      namedNode("urn:p"),
      literal("v"),
      namedNode("urn:g1"),
    ),
    quad(
      namedNode("urn:b"),
      namedNode("urn:p"),
      literal("w"),
      namedNode("urn:g2"),
    ),
  ]);
});

test("parseQuads + collectQuadsFromStream parse N-Quads graph terms", async () => {
  const nquads =
    '<urn:a> <urn:p> "v" <urn:g1> .\n<urn:b> <urn:p> "w" <urn:g2> .';

  const quads = await collectQuadsFromStream(
    parseQuads(nquads, "application/n-quads"),
  );

  assertSameQuadSet(quads, [
    quad(
      namedNode("urn:a"),
      namedNode("urn:p"),
      literal("v"),
      namedNode("urn:g1"),
    ),
    quad(
      namedNode("urn:b"),
      namedNode("urn:p"),
      literal("w"),
      namedNode("urn:g2"),
    ),
  ]);
});

test("Turtle export round-trips quads through the engine writer and parser", () => {
  const turtle = serializeTurtle(fixtureQuads, { format: "turtle" });
  const roundTripped = Array.from(parseTurtleQuads(turtle));

  assertSameQuadSet(roundTripped, fixtureQuads);

  // The turtle writer emits TriG named-graph block syntax for quads
  expect(turtle.includes("<urn:graph:public> {")).toBeTruthy();
  expect(turtle.includes("<urn:graph:private> {")).toBeTruthy();
});

test("exportQuadsResponse serializes quads that parse back to the same set", async () => {
  const response = exportQuadsResponse(fixtureQuads, {
    format: { kind: "serialized", contentType: "text/turtle" },
  });

  if (response.kind !== "serialized") {
    throw new Error("expected serialized response");
  }

  expect(response.contentType).toStrictEqual("text/turtle");

  const quads = await collectQuadsFromStream(
    parseQuads(response.data, response.contentType),
  );
  assertSameQuadSet(quads, fixtureQuads);
});

test("materializeImportQuads collects quads from a serialized TriG source", async () => {
  const trig =
    '<urn:g1> { <urn:a> <urn:p> "v" . }\n<urn:g2> { <urn:b> <urn:p> "w" . }';

  const quads = await materializeImportQuads({
    kind: "serialized",
    data: trig,
    contentType: "text/turtle",
  });

  assertSameQuadSet(quads, [
    quad(
      namedNode("urn:a"),
      namedNode("urn:p"),
      literal("v"),
      namedNode("urn:g1"),
    ),
    quad(
      namedNode("urn:b"),
      namedNode("urn:p"),
      literal("w"),
      namedNode("urn:g2"),
    ),
  ]);
});

test("materializeImportQuads collects quads from a dataset source", async () => {
  const dataset = new Store();
  fixtureQuads.forEach((q) => dataset.add(q));

  const quads = await materializeImportQuads({ kind: "dataset", dataset });

  assertSameQuadSet(quads, fixtureQuads);
});
