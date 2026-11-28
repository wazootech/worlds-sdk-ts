import type * as rdfjs from "@rdfjs/types";
import type {
  ChangeLogEntry,
  ChangeLogEntryInput,
  ChangeLogListQuery,
  ChangeLogStore,
} from "./change-log-store.ts";

/**
 * InMemoryChangeLogStore is an append-only change-log store. Entries are
 * never mutated or deleted; indexes over quadId and transactionId keep list
 * and history walks off linear scans, and a monotonic sequence number orders
 * replay deterministically even when timestamps tie.
 */
export class InMemoryChangeLogStore implements ChangeLogStore {
  private readonly entries: ChangeLogEntry[] = [];
  private readonly byQuadId = new Map<string, ChangeLogEntry[]>();
  private readonly byTransactionId = new Map<string, ChangeLogEntry[]>();

  public record(input: ChangeLogEntryInput): Promise<ChangeLogEntry> {
    const entry: ChangeLogEntry = {
      ...input,
      sequence: this.entries.length + 1,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    this.entries.push(entry);
    appendToIndex(this.byQuadId, entry.quadId, entry);
    appendToIndex(this.byTransactionId, entry.transactionId, entry);
    return Promise.resolve(entry);
  }

  public list(query?: ChangeLogListQuery): Promise<ChangeLogEntry[]> {
    let matches: readonly ChangeLogEntry[];
    if (query?.quadId !== undefined) {
      matches = this.byQuadId.get(query.quadId) ?? [];
    } else if (query?.transactionId !== undefined) {
      matches = this.byTransactionId.get(query.transactionId) ?? [];
    } else {
      matches = this.entries;
    }
    const filtered =
      query?.operation !== undefined
        ? matches.filter((entry) => entry.operation === query.operation)
        : matches;
    return Promise.resolve([...filtered]);
  }

  public history(quadId: string): Promise<ChangeLogEntry[]> {
    return Promise.resolve([...(this.byQuadId.get(quadId) ?? [])]);
  }

  public asOf(recordedAt: string): Promise<rdfjs.Quad[]> {
    const cutoff = this.entries.reduce(
      (highest, entry) =>
        entry.recordedAt <= recordedAt
          ? Math.max(highest, entry.sequence)
          : highest,
      0,
    );
    return this.asOfSequence(cutoff);
  }

  public asOfSequence(sequence: number): Promise<rdfjs.Quad[]> {
    return Promise.resolve(replayEntries(this.entries, sequence));
  }
}

/**
 * replayEntries applies add and remove entries in sequence order up to the
 * given sequence number and returns the quads present after that entry.
 */
function replayEntries(
  entries: readonly ChangeLogEntry[],
  sequence: number,
): rdfjs.Quad[] {
  const present = new Map<string, rdfjs.Quad>();
  for (const entry of entries) {
    if (entry.sequence > sequence) break;
    if (entry.operation === "add") {
      present.set(entry.quadId, entry.quad);
    } else {
      present.delete(entry.quadId);
    }
  }
  return [...present.values()];
}

/**
 * appendToIndex adds one entry to one index bucket, creating it when absent.
 */
function appendToIndex(
  index: Map<string, ChangeLogEntry[]>,
  key: string,
  entry: ChangeLogEntry,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(entry);
  } else {
    index.set(key, [entry]);
  }
}
