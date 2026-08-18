import { assertEquals } from "@std/assert";
import type {
  ConnectionDriver,
  SchemaBuilder,
  SearchQueryBuilder,
} from "./mod.ts";

/**
 * This test is a compile-time contract check for the provider-seam design
 * (worlds-sdk-ts#170): `@worlds/sdk/durable-backend` ships three strategy
 * interfaces — transport (`ConnectionDriver`), dialect (`SchemaBuilder`),
 * search SQL (`SearchQueryBuilder`) — that document the shape of a durable
 * backend. Each backend's factory constructs its own strategy objects
 * internally from the plain backend client; the interfaces are the contract
 * underneath the factory, not factory parameters. If the interfaces drift out
 * of implementable shape, this file stops compiling.
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
 * "Durable-backend seam"): the caller supplies the backend's plain client, and
 * the factory assembles the three strategy objects internally before wiring
 * the quad store and search index it returns — like `createLibsqlClient` and
 * `createDenokvClient` do today.
 */
async function createDurableBackendSdk(_options: { client: unknown }) {
  // Constructed internally, never caller-supplied parameters.
  const connection = buildStubConnection();
  const schema = buildStubSchema();
  const searchQuery = buildStubSearchQuery();

  const ddl = schema.buildTables();
  await connection.execute({ sql: "SELECT 1" });
  const compiled = searchQuery.buildSearchQuery({ query: "hello" }, {
    limit: 10,
  });
  return { ddl, compiled };
}

Deno.test("provider seam - the three strategy objects assemble inside the factory", async () => {
  const sdk = await createDurableBackendSdk({ client: {} });

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
