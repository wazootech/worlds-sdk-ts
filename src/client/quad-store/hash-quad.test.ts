import { assertEquals, assertNotEquals } from "@std/assert";
import { DataFactory } from "n3";
import { hashQuad } from "./hash-quad.ts";

const { namedNode, quad, literal } = DataFactory;

Deno.test("hashQuad produces consistent hash for identical quads", () => {
  const fixtureQuad1 = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );
  const fixtureQuad2 = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );

  const hash1 = hashQuad(fixtureQuad1);
  const hash2 = hashQuad(fixtureQuad2);

  assertEquals(hash1, hash2);
});

Deno.test("hashQuad produces different hashes for different quads", () => {
  const fixtureQuad1 = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );
  const fixtureQuad2 = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("world"),
  );

  const hash1 = hashQuad(fixtureQuad1);
  const hash2 = hashQuad(fixtureQuad2);

  assertNotEquals(hash1, hash2);
});

Deno.test("hashQuad is valid URL-safe base64", () => {
  const fixtureQuad1 = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );
  const hash = hashQuad(fixtureQuad1);

  // Verify no slashes or plus signs that are illegal in base64url
  assertEquals(hash.includes("/"), false);
  assertEquals(hash.includes("+"), false);
  assertEquals(hash.length > 0, true);
});
