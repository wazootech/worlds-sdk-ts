import type { Client, InStatement } from "@libsql/client";

/** DEFAULT_MAX_LOOKUP_CHUNK_SIZE is the default IN-clause and deletion chunk width. */
export const DEFAULT_MAX_LOOKUP_CHUNK_SIZE = 800;

/** DEFAULT_MAX_WRITE_BATCH_SIZE limits statements per LibSQL write batch. */
export const DEFAULT_MAX_WRITE_BATCH_SIZE = 500;

/** STAGING_FLUSH_THRESHOLD flushes staged SQL during large commits to avoid huge in-memory arrays. */
export const STAGING_FLUSH_THRESHOLD = 10_000;

/**
 * LibsqlBatchExecutorOptions defines the configuration for the batch executor.
 */
export interface LibsqlBatchExecutorOptions {
  /** client is the LibSQL client connection used for executing writes. */
  client: Client;

  /** writeBatchSize limits statements per LibSQL write batch. */
  writeBatchSize: number;
}

/**
 * LibsqlBatchExecutor encapsulates statement buffering and chunked execution for LibSQL.
 * It prevents memory blowouts by eagerly flushing when the staging buffer reaches the threshold.
 */
export class LibsqlBatchExecutor {
  private readonly statements: InStatement[] = [];

  public constructor(private readonly options: LibsqlBatchExecutorOptions) {}

  /**
   * stage appends statements and flushes eagerly when the staging buffer grows too large.
   */
  public async stage(source: readonly InStatement[]): Promise<void> {
    const sourceLength = source.length;
    for (let index = 0; index < sourceLength; index++) {
      this.statements.push(source[index]!);
      if (this.statements.length >= STAGING_FLUSH_THRESHOLD) {
        await this.flush();
      }
    }
  }

  /**
   * flush executes and clears all currently staged write statements.
   */
  public async flush(): Promise<void> {
    if (this.statements.length === 0) {
      return;
    }

    const { client, writeBatchSize } = this.options;

    // Execute write batches in fixed-size slices
    for (
      let index = 0;
      index < this.statements.length;
      index += writeBatchSize
    ) {
      const statementBatch = this.statements.slice(
        index,
        index + writeBatchSize,
      );
      await client.batch(statementBatch, "write");
    }

    this.statements.length = 0;
  }
}
