import type * as rdfjs from "@rdfjs/types";

/**
 * ChangeLogOperation discriminates quad additions from quad removals.
 */
export type ChangeLogOperation = "add" | "remove";

/**
 * ChangeLogEntry is one append-only change-log row: a single quad added or
 * removed by one transaction. Entries are never mutated or deleted; a removal
 * is recorded as its own row, so a deleted fact remains in the log.
 */
export interface ChangeLogEntry {
  /** sequence is the store-scoped, strictly increasing order of this entry. */
  sequence: number;

  /** transactionId groups every entry written by one transaction commit. */
  transactionId: string;

  /** recordedAt is the ISO 8601 timestamp of the transaction commit. */
  recordedAt: string;

  /** operation is "add" for an insertion and "remove" for a deletion. */
  operation: ChangeLogOperation;

  /** quadId is the content-addressed ID of the quad this entry describes. */
  quadId: string;

  /** quad is the quad that was added or removed. */
  quad: rdfjs.Quad;

  /** actor optionally names the agent or process that performed the write. */
  actor?: string;

  /** source optionally names the feed, tool, or origin the data came from. */
  source?: string;
}

/**
 * ChangeLogEntryInput is the write shape for ChangeLogStore.record;
 * recordedAt defaults to the commit time inside the store.
 */
export interface ChangeLogEntryInput {
  transactionId: string;
  recordedAt?: string;
  operation: ChangeLogOperation;
  quadId: string;
  quad: rdfjs.Quad;
  actor?: string;
  source?: string;
}

/**
 * ChangeLogListQuery narrows list to one quad, one operation, or one transaction.
 */
export interface ChangeLogListQuery {
  quadId?: string;
  operation?: ChangeLogOperation;
  transactionId?: string;
}

/**
 * ChangeLogStore is the append-only persistence contract for change-log
 * entries. Durable backends implement this over their own storage (one extra
 * table beside the quads, written in the same transaction as the mutation);
 * the in-memory implementation backs RdfjsQuadStore.
 */
export interface ChangeLogStore {
  /**
   * record appends one change-log entry. recordedAt defaults to the commit
   * time. Appending never rewrites history.
   */
  record(input: ChangeLogEntryInput): Promise<ChangeLogEntry>;

  /** list returns entries matching the query, oldest first. */
  list(query?: ChangeLogListQuery): Promise<ChangeLogEntry[]>;

  /** history returns every entry for one quad, oldest first. */
  history(quadId: string): Promise<ChangeLogEntry[]>;

  /**
   * asOf replays the log up to the given timestamp and returns the quads
   * present at that time. Entries are replayed in sequence order; entries
   * sharing one transaction timestamp are applied together.
   */
  asOf(recordedAt: string): Promise<rdfjs.Quad[]>;

  /**
   * asOfSequence replays the log up to the given sequence number and returns
   * the quads present after that entry. Sequence numbers are the durable
   * cursor: wall-clock timestamps can tie within one millisecond.
   */
  asOfSequence(sequence: number): Promise<rdfjs.Quad[]>;
}
