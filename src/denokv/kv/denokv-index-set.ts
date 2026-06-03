/**
 * DenokvQuadIndex enumerates supported KV secondary-index families used to accelerate match().
 */
export type DenokvQuadIndex =
  | "spog"
  | "sopg"
  | "psog"
  | "posg"
  | "ospg"
  | "opsg"
  | "gspo";

/** DEFAULT_DENOKV_QUAD_INDEXES enables all KV quad index families. */
export const DEFAULT_DENOKV_QUAD_INDEXES: readonly DenokvQuadIndex[] = [
  "spog",
  "sopg",
  "psog",
  "posg",
  "ospg",
  "opsg",
  "gspo",
];
