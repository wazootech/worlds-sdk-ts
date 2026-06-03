import type { Client as LibsqlClient } from "@libsql/client";
import type { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";

/**
 * initializeLibsqlSchema synchronously checks and creates the full set of persistent tables needed.
 * Hexastore covering indexes enable LibsqlRdfjsStore selective SPARQL without full hydration
 * (see https://github.com/wazootech/worlds-client-ts/discussions/45).
 */
export async function initializeLibsqlSchema(
  databaseClient: LibsqlClient,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  await databaseClient.execute(schemaBuilder.buildLibsqlQuadsTable());
  for (const ddl of schemaBuilder.buildIndexes()) {
    await databaseClient.execute(ddl);
  }
  await databaseClient.execute(schemaBuilder.buildLibsqlChunksTable());
  await migrateLibsqlChunksFtsValue(databaseClient, schemaBuilder);
  await databaseClient.execute(schemaBuilder.buildLibsqlChunksQuadIdIndex());
  await recreateLibsqlChunksFts(databaseClient, schemaBuilder);
  await databaseClient.execute(schemaBuilder.buildLibsqlChunksIndex());
}

/**
 * migrateLibsqlChunksFtsValue adds fts_value to legacy chunk tables and backfills from value when missing.
 */
async function migrateLibsqlChunksFtsValue(
  databaseClient: LibsqlClient,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  const tableInfo = await databaseClient.execute("PRAGMA table_info(chunks)");
  const hasFtsValueColumn = tableInfo.rows.some((row) =>
    String(row.name) === "fts_value"
  );

  if (!hasFtsValueColumn) {
    try {
      await databaseClient.execute(
        schemaBuilder.buildMigrateChunksFtsValueColumn(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate column")) {
        throw error;
      }
    }
    await databaseClient.execute(
      schemaBuilder.buildBackfillChunksFtsValueFromValue(),
    );
  }
}

/**
 * recreateLibsqlChunksFts rebuilds FTS5 virtual tables and triggers so discovery indexes fts_value.
 */
async function recreateLibsqlChunksFts(
  databaseClient: LibsqlClient,
  schemaBuilder: LibsqlSchemaBuilder,
): Promise<void> {
  for (const dropTriggerSql of schemaBuilder.buildDropChunksFtsTriggers()) {
    await databaseClient.execute(dropTriggerSql);
  }

  const ftsTableExists = await databaseClient.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'",
  );
  if (ftsTableExists.rows.length > 0) {
    const ftsColumns = await databaseClient.execute(
      "PRAGMA table_info(chunks_fts)",
    );
    const indexesFtsValue = ftsColumns.rows.some((row) =>
      String(row.name) === "fts_value"
    );
    if (!indexesFtsValue) {
      await databaseClient.execute(schemaBuilder.buildDropChunksFtsTable());
    }
  }

  await databaseClient.execute(schemaBuilder.buildLibsqlChunksFtsTable());
  for (const triggerSql of schemaBuilder.buildLibsqlChunksTriggers()) {
    await databaseClient.execute(triggerSql);
  }

  const chunkCount = await databaseClient.execute(
    "SELECT COUNT(*) AS total FROM chunks",
  );
  const totalChunks = Number(chunkCount.rows[0]?.total ?? 0);
  if (totalChunks > 0) {
    try {
      await databaseClient.execute(schemaBuilder.buildRebuildChunksFtsIndex());
    } catch {
      // FTS rebuild is best-effort during migration; callers can run rebuildLibsqlSearchIndexFromQuads.
    }
  }
}
