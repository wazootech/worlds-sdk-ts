import type { ConnectionDriver } from "./connection-driver.ts";
import type { SchemaBuilder } from "./schema-builder.ts";
import type { QuadStoreBackend } from "./quad-store-backend.ts";
import type { SearchQueryBuilder } from "./search-query-builder.ts";

/**
 * DurableBackendParts is the composite of the four provider-seam strategy
 * objects a durable backend supplies. A backend is interchangeable when it
 * provides all four parts; the shared Worlds layer wires them into the Sdk
 * facade. (Migration step 1 of the provider-seam design — types only, no
 * behavior moves; see worlds-sdk-ts#164.)
 */
export interface DurableBackendParts {
  /** connection wraps the backend's transport behind a uniform SQL surface. */
  connection: ConnectionDriver;

  /** schema owns the backend's storage dialect (DDL + migrations). */
  schema: SchemaBuilder;

  /** quadStore implements import/export/transaction over driver + schema. */
  quadStore: QuadStoreBackend;

  /** searchQuery builds the backend's keyword/vector candidate SQL. */
  searchQuery: SearchQueryBuilder;
}
