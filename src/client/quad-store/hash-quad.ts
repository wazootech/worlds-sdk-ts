import type * as rdfjs from "@rdfjs/types";
import { sha256Hex } from "@wazoo/sparql-engine/term";
import { decodeHex } from "@std/encoding/hex";
import { encodeBase64Url } from "@std/encoding/base64url";
import { serializeQuadToCanonicalNQuads } from "./canonical-nquads.ts";

/**
 * SCHEME_TAG identifies the quad ID scheme so old and new IDs are
 * distinguishable at a glance and mixed-scheme data is detectable.
 */
const SCHEME_TAG = "q2.";

/**
 * hashQuad computes a content-addressed ID for a single quad: the SHA-256
 * digest of the quad's canonical N-Quads serialization, base64url-encoded
 * and prefixed with the scheme tag (2 + 43 = 46 chars total).
 *
 * For blank-node-free quads the serialization is byte-identical to the
 * RDFC-1.0 canonical form (rdf-canonize), so IDs are interoperable with
 * RDFC-1.0-based content-addressed systems. Blank nodes are label-based
 * (dataset-local), per the Statement Hash convention — see
 * serializeQuadToCanonicalNQuads.
 */
export function hashQuad(quad: rdfjs.Quad): string {
  const canonical = serializeQuadToCanonicalNQuads(quad);
  const digest = decodeHex(sha256Hex(canonical));
  return SCHEME_TAG + encodeBase64Url(digest);
}

/**
 * hashQuads computes deterministic content-addressed IDs for multiple quads.
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
