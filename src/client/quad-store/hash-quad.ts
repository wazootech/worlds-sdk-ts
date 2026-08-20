import type * as rdfjs from "@rdfjs/types";
import { termKey } from "@wazoo/sparql-engine/term";
import { sha256Hex } from "@wazoo/sparql-engine/term";
import { encodeBase64Url } from "@std/encoding/base64url";

/**
 * hashQuad computes a deterministic, canonical ID for a single Quad
 * using termKey serialization and SHA-256 hashing, encoded as base64url.
 *
 * This is functionally equivalent to "Skolemizing" the statement into a stable primary key.
 * termKey produces a deterministic string representation of the quad's components,
 * and sha256Hex provides collision-resistant hashing.
 */
export function hashQuad(quad: rdfjs.Quad): string {
  return encodeBase64Url(
    new TextEncoder().encode(sha256Hex(termKey(quad))),
  );
}

/**
 * hashQuads computes deterministic canonical IDs for multiple quads.
 */
export function hashQuads(quads: rdfjs.Quad[]): string[] {
  try {
    return quads.map((quad) => hashQuad(quad));
  } catch (cause) {
    throw new Error("failed to compute content hashes for incoming quads", {
      cause,
    });
  }
}
