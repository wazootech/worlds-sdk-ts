import type {
  QuadStoreInterface,
  Transaction,
} from "@/client/quad-store/mod.ts";

/**
 * QuadStoreBackend is the durable implementation of the quad store half of
 * the provider seam: it satisfies the shared QuadStoreInterface
 * (import/export) over a ConnectionDriver + SchemaBuilder, and exposes a
 * createTransaction whose commit hook drives search-chunk projection.
 */
export interface QuadStoreBackend extends QuadStoreInterface {
  /**
   * createTransaction returns a pre-configured Transaction bound to the
   * backend's commit hooks (durable persistence plus chunk projection).
   * @returns A transaction scoped to a single patch commit.
   */
  createTransaction(): Transaction;
}
