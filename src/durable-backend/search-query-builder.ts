import type { SearchRequest } from "@/client/search-index/mod.ts";

/**
 * ChunkInsert describes one search-chunk row to be written by the backend.
 */
export interface ChunkInsert {
  /** quad_id is the source quad's stable id. */
  quad_id: string;

  /** subject is the quad's subject term value. */
  subject: string;

  /** predicate is the quad's predicate term value. */
  predicate: string;

  /** graph is the quad's graph term value. */
  graph: string;

  /** value is the literal text indexed for display. */
  value: string;

  /** fts_value is the text fed to the FTS index. */
  fts_value: string;

  /** vectorJson is the serialized embedding, when vectors are enabled. */
  vectorJson?: string | null;
}

/**
 * CompiledStatement is a parameterized SQL statement plus its bind values.
 */
export interface CompiledStatement {
  /** sql is the statement text, using `?` placeholders. */
  sql: string;

  /** args are the positional bind values for the statement's placeholders. */
  args: (string | number)[];
}

/**
 * SearchQueryBuilder builds the backend's search SQL: keyword and vector
 * candidate queries over the chunk tables, chunk row writes, and quad-scoped
 * chunk deletes. It is a signal-source adapter — the shared Worlds layer
 * performs fusion over the candidates this builder produces.
 */
export interface SearchQueryBuilder {
  /**
   * buildSearchQuery compiles a SearchRequest into a parameterized candidate
   * query (keyword and/or vector, per the request and provided vector).
   * @param request The search request to compile.
   * @param options vectorJson (optional serialized embedding) and candidate limit.
   * @returns The compiled query statement.
   */
  buildSearchQuery(
    request: SearchRequest,
    options: { vectorJson?: string; limit: number },
  ): CompiledStatement;

  /**
   * buildInsertChunk compiles a chunk row insert.
   * @param insert The chunk row to insert.
   * @returns The compiled insert statement.
   */
  buildInsertChunk(insert: ChunkInsert): CompiledStatement;

  /**
   * buildDeleteByQuadIds compiles chunk deletes for the given quad ids.
   * @param quadIds The source quad ids whose chunks should be deleted.
   * @returns The compiled delete statement.
   */
  buildDeleteByQuadIds(quadIds: string[]): CompiledStatement;
}
