import type * as rdfjs from "@rdfjs/types";

import { termKeyParts } from "./denokv-keys.ts";
import type { DenokvQuadIndex } from "./denokv-index-set.ts";

/**
 * buildBestMatchSelector returns the narrowest KV list prefix for a quad pattern.
 */
export function buildBestMatchSelector(
  scopedDataPrefix: Deno.KvKey,
  enabledIndexes: readonly DenokvQuadIndex[],
  pattern: {
    subject: rdfjs.Term | null;
    predicate: rdfjs.Term | null;
    object: rdfjs.Term | null;
    graph: rdfjs.Term | null;
  },
): Deno.KvListSelector {
  if (
    !pattern.subject &&
    !pattern.predicate &&
    !pattern.object &&
    !pattern.graph
  ) {
    return { prefix: [...scopedDataPrefix, "quads"] };
  }

  if (pattern.subject && enabledIndexes.includes("spog")) {
    const parts: Deno.KvKeyPart[] = [...termKeyParts(pattern.subject)];
    if (pattern.predicate) {
      parts.push(...termKeyParts(pattern.predicate));
      if (pattern.object) {
        parts.push(...termKeyParts(pattern.object));
        if (pattern.graph) {
          parts.push(...termKeyParts(pattern.graph));
        }
      }
    }
    return { prefix: [...scopedDataPrefix, "idx_spog", ...parts] };
  }

  if (
    pattern.subject &&
    pattern.object &&
    !pattern.predicate &&
    enabledIndexes.includes("sopg")
  ) {
    const parts: Deno.KvKeyPart[] = [
      ...termKeyParts(pattern.subject),
      ...termKeyParts(pattern.object),
    ];
    if (pattern.graph) {
      parts.push(...termKeyParts(pattern.graph));
    }
    return { prefix: [...scopedDataPrefix, "idx_sopg", ...parts] };
  }

  if (
    pattern.object &&
    pattern.predicate &&
    !pattern.subject &&
    enabledIndexes.includes("opsg")
  ) {
    const parts: Deno.KvKeyPart[] = [
      ...termKeyParts(pattern.object),
      ...termKeyParts(pattern.predicate),
    ];
    if (pattern.graph) {
      parts.push(...termKeyParts(pattern.graph));
    }
    return { prefix: [...scopedDataPrefix, "idx_opsg", ...parts] };
  }

  if (
    pattern.predicate &&
    pattern.subject &&
    !pattern.object &&
    enabledIndexes.includes("psog")
  ) {
    const parts: Deno.KvKeyPart[] = [
      ...termKeyParts(pattern.predicate),
      ...termKeyParts(pattern.subject),
    ];
    if (pattern.graph) {
      parts.push(...termKeyParts(pattern.graph));
    }
    return { prefix: [...scopedDataPrefix, "idx_psog", ...parts] };
  }

  if (pattern.predicate && enabledIndexes.includes("posg")) {
    const parts: Deno.KvKeyPart[] = [...termKeyParts(pattern.predicate)];
    if (pattern.object) {
      parts.push(...termKeyParts(pattern.object));
      if (pattern.subject) {
        parts.push(...termKeyParts(pattern.subject));
        if (pattern.graph) {
          parts.push(...termKeyParts(pattern.graph));
        }
      }
    }
    return { prefix: [...scopedDataPrefix, "idx_posg", ...parts] };
  }

  if (pattern.object && enabledIndexes.includes("ospg")) {
    const parts: Deno.KvKeyPart[] = [...termKeyParts(pattern.object)];
    if (pattern.subject) {
      parts.push(...termKeyParts(pattern.subject));
      if (pattern.predicate) {
        parts.push(...termKeyParts(pattern.predicate));
        if (pattern.graph) {
          parts.push(...termKeyParts(pattern.graph));
        }
      }
    }
    return { prefix: [...scopedDataPrefix, "idx_ospg", ...parts] };
  }

  if (pattern.graph && enabledIndexes.includes("gspo")) {
    const parts: Deno.KvKeyPart[] = [...termKeyParts(pattern.graph)];
    if (pattern.subject) {
      parts.push(...termKeyParts(pattern.subject));
      if (pattern.predicate) {
        parts.push(...termKeyParts(pattern.predicate));
        if (pattern.object) {
          parts.push(...termKeyParts(pattern.object));
        }
      }
    }
    return { prefix: [...scopedDataPrefix, "idx_gspo", ...parts] };
  }

  return { prefix: [...scopedDataPrefix, "quads"] };
}

/**
 * buildBestMatchCursor classifies a selector as index-backed or primary quad scan.
 */
export function buildBestMatchCursor(
  scopedDataPrefix: Deno.KvKey,
  enabledIndexes: readonly DenokvQuadIndex[],
  pattern: {
    subject: rdfjs.Term | null;
    predicate: rdfjs.Term | null;
    object: rdfjs.Term | null;
    graph: rdfjs.Term | null;
  },
): {
  kind: "index";
  selector: Deno.KvListSelector;
} | {
  kind: "primary";
  selector: Deno.KvListSelector;
} {
  const selector = buildBestMatchSelector(
    scopedDataPrefix,
    enabledIndexes,
    pattern,
  );
  const prefix = "prefix" in selector ? selector.prefix : undefined;

  if (prefix?.some((part) => String(part).startsWith("idx_"))) {
    return { kind: "index", selector };
  }

  return { kind: "primary", selector };
}

/**
 * matchesPattern returns true when candidate satisfies all bound pattern terms.
 */
export function matchesPattern(
  candidate: rdfjs.Quad,
  pattern: {
    subject: rdfjs.Term | null;
    predicate: rdfjs.Term | null;
    object: rdfjs.Term | null;
    graph: rdfjs.Term | null;
  },
): boolean {
  if (pattern.subject && !candidate.subject.equals(pattern.subject)) {
    return false;
  }
  if (pattern.predicate && !candidate.predicate.equals(pattern.predicate)) {
    return false;
  }
  if (pattern.object && !candidate.object.equals(pattern.object)) return false;
  if (pattern.graph && !candidate.graph.equals(pattern.graph)) return false;
  return true;
}
