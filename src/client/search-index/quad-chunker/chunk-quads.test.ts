import { expect, test } from "bun:test";
import { DataFactory } from "n3";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { chunkQuads } from "./chunk-quads.ts";

const { quad, namedNode, literal } = DataFactory;

test("QuadChunker.chunk - ingests short literal quad", async () => {
  // Construct a test quad: <urn:bob> <urn:bio> "Bob is a dev"
  const testQuad = quad(
    namedNode("urn:bob"),
    namedNode("urn:bio"),
    literal("Bob is a dev"),
  );

  // Execute chunking
  const chunks = await chunkQuads(
    [testQuad],
    new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    }),
  );

  // Verify single output mapping exactly
  expect(chunks.length).toStrictEqual(1);
  expect(chunks[0].subject).toStrictEqual("urn:bob");
  expect(chunks[0].predicate).toStrictEqual("urn:bio");
  expect(chunks[0].graph).toStrictEqual(""); // default graph value in N3
  expect(chunks[0].value).toStrictEqual("Bob is a dev");
});

test("QuadChunker.chunk - splits large text across chunks", async () => {
  // Total length ~23, should yield at least 2-3 chunks at max 10 chars each
  const testQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("First line.\nSecond line."),
  );

  const chunks = await chunkQuads(
    [testQuad],
    new RecursiveCharacterTextSplitter({
      chunkSize: 10,
      chunkOverlap: 0,
    }),
  );

  // Should have generated multiple distinct items
  expect(chunks.length > 1).toStrictEqual(true);

  // All derived chunks must preserve the source relation identifers
  for (const c of chunks) {
    expect(c.subject).toStrictEqual("urn:subject");
    expect(c.predicate).toStrictEqual("urn:predicate");
  }

  // Combined text should generally reconstruct original content
  const combined = chunks.map((c) => c.value).join("");
  // Depending on how whitespace is trimmed, simple check
  expect(combined.includes("First")).toStrictEqual(true);
  expect(combined.includes("Second")).toStrictEqual(true);
});

test("QuadChunker.chunk - ignores non-literal nodes", async () => {
  const linkQuad = quad(
    namedNode("urn:alice"),
    namedNode("urn:knows"),
    namedNode("urn:bob"), // Non-literal object
  );

  const chunks = await chunkQuads(
    [linkQuad],
    new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    }),
  );

  // Expected to discard since it's not indexable text
  expect(chunks.length).toStrictEqual(0);
});

test("QuadChunker.chunk - handles parallel quad batches", async () => {
  const inputBatch = [
    quad(namedNode("urn:q1"), namedNode("urn:p1"), literal("Doc One")),
    quad(namedNode("urn:q2"), namedNode("urn:p2"), literal("Doc Two")),
  ];

  const results = await chunkQuads(
    inputBatch,
    new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 0,
    }),
  );

  // Should correlate back correctly
  expect(results.length).toStrictEqual(2);
  expect(results[0].subject).toStrictEqual("urn:q1");
  expect(results[0].value).toStrictEqual("Doc One");
  expect(results[1].subject).toStrictEqual("urn:q2");
  expect(results[1].value).toStrictEqual("Doc Two");
});

test("QuadChunker.chunk - ignores structured primitive literals (number/boolean)", async () => {
  const numberQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
  );

  const booleanQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("true", namedNode("http://www.w3.org/2001/XMLSchema#boolean")),
  );

  const dateQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal(
      "2026-05-12T12:00:00Z",
      namedNode("http://www.w3.org/2001/XMLSchema#dateTime"),
    ),
  );

  const chunks = await chunkQuads(
    [numberQuad, booleanQuad, dateQuad],
    new RecursiveCharacterTextSplitter({ chunkSize: 1000 }),
  );

  expect(chunks.length).toStrictEqual(0);
});

test("QuadChunker.chunk - accepts explicit strings and localized language strings", async () => {
  const stringQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal(
      "explicit text",
      namedNode("http://www.w3.org/2001/XMLSchema#string"),
    ),
  );

  const langQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("bonjour", "fr"), // Automatically generates rdf:langString datatype
  );

  const chunks = await chunkQuads(
    [stringQuad, langQuad],
    new RecursiveCharacterTextSplitter({ chunkSize: 1000 }),
  );

  expect(chunks.length).toStrictEqual(2);
  expect(chunks[0].value).toStrictEqual("explicit text");
  expect(chunks[1].value).toStrictEqual("bonjour");
});
