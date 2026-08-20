import { assertEquals, assertNotEquals } from "@std/assert";
import { DataFactory } from "n3";
import { encodeBase64Url } from "@std/encoding/base64url";
import { hashQuad } from "./hash-quad.ts";
import { serializeQuadToCanonicalNQuads } from "./canonical-nquads.ts";

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

Deno.test("hashQuad matches the golden RDFC-1.0-derived id", () => {
  const fixture = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );
  // q2. + base64url(sha256("<s> <p> \"hello\" .\n")) — the canonical
  // N-Quads form matches rdf-canonize RDFC-1.0 output byte-for-byte.
  assertEquals(
    hashQuad(fixture),
    "q2.Qadou5ZTTT9v7Qasbsrp2FBsAs9ydKVk3D4x_96G-W8",
  );
});

Deno.test("hashQuad equals q2. + base64url(sha256(canonical N-Quads)) per Web Crypto", async () => {
  const fixture = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("bonjour", "fr"),
  );
  const canonical = serializeQuadToCanonicalNQuads(fixture);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  assertEquals(
    hashQuad(fixture),
    "q2." + encodeBase64Url(new Uint8Array(digest)),
  );
});

Deno.test("hashQuad emits the q2. scheme tag and fixed-length URL-safe ids", () => {
  const fixture = quad(
    namedNode("http://example.org/s"),
    namedNode("http://example.org/p"),
    literal("hello"),
  );
  const hash = hashQuad(fixture);

  // "q2." tag + 43 base64url chars of the 32-byte SHA-256 digest
  assertEquals(hash.startsWith("q2."), true);
  assertEquals(hash.length, 46);
  assertEquals(hash.includes("/"), false);
  assertEquals(hash.includes("+"), false);

  // distinct quads — including escaped values and named graphs — stay distinct
  assertNotEquals(
    hashQuad(
      quad(
        namedNode("http://example.org/s"),
        namedNode("http://example.org/p"),
        literal("a|b"),
      ),
    ),
    hash,
  );
  assertNotEquals(
    hashQuad(
      quad(
        namedNode("http://example.org/s"),
        namedNode("http://example.org/p"),
        literal("hello"),
        namedNode("http://example.org/g"),
      ),
    ),
    hash,
  );
});
