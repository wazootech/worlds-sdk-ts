/**
 * SqlStatement is a single parameterized SQL statement.
 */
export interface SqlStatement {
  /** sql is the statement text, using `?` placeholders. */
  sql: string;

  /** args are the positional bind values for the statement's placeholders. */
  args?: unknown[];
}

/**
 * SqlResult is the outcome of executing a single statement.
 */
export interface SqlResult<Row = Record<string, unknown>> {
  /** rows are the returned result rows (empty for writes). */
  rows: Row[];
}

/**
 * SqlExecutor is the minimal statement-execution surface a backend exposes —
 * used both for top-level calls and inside a transaction scope.
 */
export interface SqlExecutor {
  /**
   * execute runs a single parameterized statement and returns its rows.
   * @param statement The statement to execute.
   * @returns A promise resolving to the result rows.
   */
  execute<Row = Record<string, unknown>>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>>;

  /**
   * batch executes multiple write statements in one round-trip.
   * @param statements The statements to execute atomically as a batch.
   * @returns A promise resolving when the batch completes.
   */
  batch?(statements: readonly SqlStatement[]): Promise<unknown>;
}

/**
 * ConnectionDriver wraps the durable backend's transport (e.g. LibSQL's
 * remote/embedded client or node:sqlite's DatabaseSync) behind a uniform SQL
 * surface: statement execution, transactions, optional write batching, and
 * lifecycle. It owns the transport; backends never touch it directly.
 */
export interface ConnectionDriver extends SqlExecutor {
  /**
   * transaction runs the given function inside an atomic transaction and
   * commits on success (rolling back on throw).
   * @param fn The work to run inside the transaction.
   * @returns A promise resolving to the function's result.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;

  /**
   * close releases the underlying transport.
   * @returns A promise resolving when the transport is closed.
   */
  close(): Promise<void>;
}
