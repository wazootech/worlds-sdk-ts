import { assertEquals } from "@std/assert";
import type {
  ConnectionDriver,
  SchemaBuilder,
  SearchQueryBuilder,
} from "./mod.ts";

/**
 * This test is a compile-time contract check for the provider-seam design
 * (worlds-sdk-ts#170): a durable backend factory takes the three strategy
 * objects as parameters and assembles its own quad store and search index
 * internally. The test builds a minimal stub of each strategy interface and
 * passes them to a factory call shaped like the live factories
 * (`createLibsqlClient`, `createDenokvClient`, future `createSqliteSdk`).
 * If the interfaces drift out of implementable shape, this file stops
 * compiling.
 */
function buildStubConnection(): ConnectionDriver {
  return {
    execute() {
      return Promise.resolve({ rows: [] });
    },
    batch() {
      return Promise.resolve();
    },
    async transaction(fn) {
      return await fn(this);
    },
    close() {
      return Promise.resolve();
    },
  };
}

function buildStubSchema(): SchemaBuilder {
  return {
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
}

function buildStubSearchQuery(): SearchQueryBuilder {
  return {
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
}

/**
 * The factory shape every durable backend follows (see ARCHITECTURE.md
 * "Durable-backend seam"): the three strategy objects are the parameters, and
 * the factory owns the quad store and search index it assembles from them.
 */
async function createDurableBackendSdk(options: {
  connection: ConnectionDriver;
  schema: SchemaBuilder;
  searchQuery: SearchQueryBuilder;
}) {
  // The factory consumes the three strategy objects to build the backend's
  // quad store and search index; nothing here is a caller-supplied composite.
  const { connection, schema, searchQuery } = options;
  const ddl = schema.buildTables();
  await connection.execute({ sql: "SELECT 1" });
  const compiled = searchQuery.buildSearchQuery({ query: "hello" }, {
    limit: 10,
  });
  return { ddl, compiled };
}

Deno.test("provider seam - the three strategy objects satisfy a factory call", async () => {
  const sdk = await createDurableBackendSdk({
    connection: buildStubConnection(),
    schema: buildStubSchema(),
    searchQuery: buildStubSearchQuery(),
  });

  // The factory consumed all three parameters to assemble the backend.
  assertEquals(Array.isArray(sdk.ddl), true);
  assertEquals(typeof sdk.compiled.sql, "string");
});

Deno.test("SearchQueryBuilder - compiled statements carry sql + positional args", () => {
  const searchQuery = buildStubSearchQuery();
  const compiled = searchQuery.buildSearchQuery(
    { query: "hello" },
    { limit: 10 },
  );
  assertEquals(typeof compiled.sql, "string");
  assertEquals(Array.isArray(compiled.args), true);
});
