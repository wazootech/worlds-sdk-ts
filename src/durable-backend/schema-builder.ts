/**
 * SchemaBuilder owns the durable backend's storage dialect: the DDL that
 * creates the quad and search tables, the covering/search indexes, and any
 * ordered migration steps for pre-existing databases. No SQL is shared
 * between backends — each builder emits its own dialect.
 */
export interface SchemaBuilder {
  /**
   * vectorDimensions pins the vector column width for chunk embeddings and
   * must match every embedding produced for the backend.
   */
  readonly vectorDimensions: number;

  /**
   * buildTables returns the idempotent DDL that creates the storage tables
   * (quads, chunks, search tables) for this backend's dialect.
   * @returns The table-creation statements in dependency order.
   */
  buildTables(): string[];

  /**
   * buildIndexes returns the idempotent DDL for covering and search indexes
   * over the tables created by buildTables.
   * @returns The index-creation statements.
   */
  buildIndexes(): string[];

  /**
   * migrations returns ordered DDL for upgrading pre-existing databases to
   * the current schema, newest-first-safe only in sequence.
   * @returns The migration statements, or undefined when none are needed.
   */
  migrations?(): string[];
}
