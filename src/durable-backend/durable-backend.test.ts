import { assertEquals } from "@std/assert";
import { Transaction } from "@/client/quad-store/mod.ts";
import type {
  ConnectionDriver,
  DurableBackendParts,
  QuadStoreBackend,
  SchemaBuilder,
  SearchQueryBuilder,
} from "./mod.ts";

/**
 * This test is a compile-time contract check for the provider-seam
 * interfaces (worlds-sdk-ts#168): it builds a minimal stub DurableBackendParts
 * and proves the four strategy interfaces are coherent and implementable
 * without moving any behavior. If the interfaces drift out of implementable
 * shape, this file stops compiling.
 */
function buildStubParts(): DurableBackendParts {
  const connection: ConnectionDriver = {
    async execute() {
      return { rows: [] };
    },
    async batch() {},
    async transaction(fn) {
      return await fn(this);
    },
    async close() {},
  };

  const schema: SchemaBuilder = {
    vectorDimensions: 32,
    buildTables() {
      return ["CREATE TABLE IF NOT EXISTS quads (id TEXT PRIMARY KEY)"];
    },
    buildIndexes() {
      return ["CREATE INDEX IF NOT EXISTS idx_quads_spog ON quads(s, p, o, g)"];
    },
    migrations() {
      return [];
    },
  };

  const searchQuery: SearchQueryBuilder = {
    buildSearchQuery(_request, options) {
      return {
        sql:
          `SELECT rowid, value FROM chunks ORDER BY distance LIMIT ${options.limit}`,
        args: options.vectorJson ? [options.vectorJson] : [],
      };
    },
    buildInsertChunk(insert) {
      return {
        sql: "INSERT INTO chunks (quad_id, subject) VALUES (?, ?)",
        args: [insert.quad_id, insert.subject],
      };
    },
    buildDeleteByQuadIds(quadIds) {
      return {
        sql: `DELETE FROM chunks WHERE quad_id IN (${
          quadIds.map(() => "?").join(", ")
        })`,
        args: quadIds,
      };
    },
  };

  const quadStore: QuadStoreBackend = {
    createTransaction() {
      return new Transaction({});
    },
    async import() {},
    async export() {
      return { kind: "quads", quads: [] };
    },
  };

  return { connection, schema, quadStore, searchQuery };
}

Deno.test("DurableBackendParts - the four strategy interfaces compose into one backend", () => {
  const parts = buildStubParts();

  // All four parts are wired and named per the seam design.
  assertEquals(typeof parts.connection.execute, "function");
  assertEquals(typeof parts.schema.buildTables, "function");
  assertEquals(typeof parts.quadStore.createTransaction, "function");
  assertEquals(typeof parts.searchQuery.buildSearchQuery, "function");
});

Deno.test("SearchQueryBuilder - compiled statements carry sql + positional args", async () => {
  const parts = buildStubParts();
  const compiled = parts.searchQuery.buildSearchQuery(
    { query: "hello" },
    { limit: 10 },
  );
  assertEquals(typeof compiled.sql, "string");
  assertEquals(Array.isArray(compiled.args), true);
});
