/** Maximum embedding dimensions accepted by LibsqlSchemaBuilder (LibSQL / resource guardrail). */
const LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS = 8192;

/**
 * LibsqlSchemaBuilder exposes DDL/DML helpers bound to a single vector dimension for schema initialization.
 */
export class LibsqlSchemaBuilder {
  public readonly vectorDimensions: number;

  public constructor(vectorDimensions: number) {
    const dimensions = Math.floor(Number(vectorDimensions));
    if (
      !Number.isFinite(dimensions) ||
      dimensions < 1 ||
      dimensions > LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS
    ) {
      throw new Error(
        `vectorDimensions must be a finite integer in [1, ${LIBSQL_QUERY_BUILDER_MAX_VECTOR_DIMENSIONS}], received: ${
          String(vectorDimensions)
        }`,
      );
    }
    this.vectorDimensions = dimensions;
  }

  /**
   * buildIndexes returns DDL for 7 covering composite indexes on the quads table
   * (six subject-predicate-object-graph index orders + GPSO for graph-scoped access) enabling any quad pattern
   * to be resolved via a single index seek.
   */
  public buildIndexes(): string[] {
    return [
      "CREATE INDEX IF NOT EXISTS idx_quads_spog ON quads(s, p, o, g)",
      "CREATE INDEX IF NOT EXISTS idx_quads_sopg ON quads(s, o, p, g)",
      "CREATE INDEX IF NOT EXISTS idx_quads_pso ON quads(p, s, o)",
      "CREATE INDEX IF NOT EXISTS idx_quads_pos ON quads(p, o, s)",
      "CREATE INDEX IF NOT EXISTS idx_quads_ospg ON quads(o, s, p, g)",
      "CREATE INDEX IF NOT EXISTS idx_quads_opsg ON quads(o, p, s, g)",
      "CREATE INDEX IF NOT EXISTS idx_quads_gpso ON quads(g, p, s, o)",
    ];
  }

  public buildLibsqlQuadsTable(): string {
    return `CREATE TABLE IF NOT EXISTS quads (
    id TEXT PRIMARY KEY,
    s TEXT NOT NULL,
    s_type TEXT NOT NULL,
    p TEXT NOT NULL,
    o TEXT NOT NULL,
    o_type TEXT NOT NULL,
    o_datatype TEXT,
    o_lang TEXT,
    g TEXT NOT NULL,
    g_type TEXT NOT NULL
  )`;
  }

  public buildLibsqlChunksTable(): string {
    return `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quad_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    graph TEXT NOT NULL,
    value TEXT NOT NULL,
    fts_value TEXT NOT NULL,
    vector F32_BLOB(${this.vectorDimensions})
  )`;
  }

  public buildLibsqlChunksQuadIdIndex(): string {
    return `CREATE INDEX IF NOT EXISTS idx_chunks_quad_id ON chunks (quad_id)`;
  }

  public buildLibsqlChunksFtsTable(): string {
    return `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    fts_value,
    content='chunks',
    content_rowid='id'
  )`;
  }

  public buildLibsqlChunksIndex(): string {
    return `CREATE INDEX IF NOT EXISTS idx_chunks_vector ON chunks (
    libsql_vector_idx(vector, 'metric=cosine')
  )`;
  }

  public buildLibsqlChunksTriggers(): string[] {
    return [
      `CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, fts_value) VALUES (new.id, new.fts_value);
    END;`,
      `CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, fts_value) VALUES('delete', old.id, old.fts_value);
    END;`,
    ];
  }

  /**
   * buildMigrateChunksFtsValueColumn returns DDL to add fts_value when upgrading legacy databases.
   */
  public buildMigrateChunksFtsValueColumn(): string {
    return "ALTER TABLE chunks ADD COLUMN fts_value TEXT";
  }

  /**
   * buildBackfillChunksFtsValueFromValue copies literal value into fts_value for rows missing discovery text.
   */
  public buildBackfillChunksFtsValueFromValue(): string {
    return "UPDATE chunks SET fts_value = value WHERE fts_value IS NULL OR fts_value = ''";
  }

  /**
   * buildDropChunksFtsTriggers returns statements that remove legacy FTS sync triggers before recreation.
   */
  public buildDropChunksFtsTriggers(): string[] {
    return [
      "DROP TRIGGER IF EXISTS chunks_ai",
      "DROP TRIGGER IF EXISTS chunks_ad",
    ];
  }

  /**
   * buildDropChunksFtsTable drops the FTS5 virtual table so it can be recreated with fts_value indexing.
   */
  public buildDropChunksFtsTable(): string {
    return "DROP TABLE IF EXISTS chunks_fts";
  }

  /**
   * buildRebuildChunksFtsIndex rebuilds the external FTS index from the chunks content table.
   */
  public buildRebuildChunksFtsIndex(): string {
    return "INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')";
  }
}
