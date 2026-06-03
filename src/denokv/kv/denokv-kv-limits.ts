/**
 * denokvKvLimits summarizes Deno KV constraints and the native batched atomic
 * helper that works around them.
 *
 * Deno KV enforces per-key value size (~64 KiB), per-atomic mutation count, and
 * per-commit total key bytes (~80 KiB) and payload size (~800 KiB); see
 * `deno/ext/kv/lib.rs`.
 *
 * **Large transactions** — the local {@linkcode BatchedAtomicOperation}
 * queues mutations, then splits them across as many `atomic.commit()` calls as
 * needed so callers do not hit key-size or mutation limits during bulk quad
 * index writes.
 *
 * Hexastore secondary index keys embed RDF term parts for `match()` routing.
 * Long literals inflate *key* byte size (not value size); batching addresses
 * that at commit time. Shortening keys (hashed term segments) would be a
 * separate schema change.
 */

// ---------------------------------------------------------------------------
// Deno KV per-transaction limits (from deno/ext/kv/lib.rs, with safety margin)
// ---------------------------------------------------------------------------

/** Max checks per atomic batch (Deno limit: 99, margin: 99). */
const MAX_CHECKS = 99;

/** Max mutations per atomic batch (Deno limit: 999, margin: 999). */
const MAX_MUTATIONS = 999;

/** Max total payload (keys + values) per atomic batch in bytes. */
const MAX_TOTAL_PAYLOAD_BYTES = 750_000;

/** Max total key size per atomic batch in bytes. */
const MAX_TOTAL_KEY_BYTES = 75_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * estimateSize returns a byte-length estimate of a Deno KV-serialisable value.
 * Used to stay under Deno KV per-batch byte limits. Over-estimation is safe
 * (causes earlier batch splits); under-estimation risks commit failures.
 */
function estimateSize(value: unknown): number {
  if (typeof value === "string") {
    return new TextEncoder().encode(value).length;
  }
  if (typeof value === "number") {
    return 8;
  }
  if (typeof value === "boolean") {
    return 1;
  }
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }
  if (typeof value === "bigint") {
    return 8;
  }
  if (value === null) {
    return 0;
  }
  // Fallback: JSON-stringify for objects and arrays.
  const text = JSON.stringify(value);
  if (text === undefined) {
    return 1024; // Conservative fallback for unserialisable values.
  }
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------
// BatchedAtomicOperation — native replacement for kv-toolbox batchedAtomic
// ---------------------------------------------------------------------------

import { pooledMap } from "@std/async/pool";

type MutateMethod = "set" | "delete";

interface CommitTask {
  mutations: Array<{ method: MutateMethod; args: unknown[] }>;
}

/** BatchedAtomicOperation is a native atomic queue for quad index bulk writes. */
export class BatchedAtomicOperation {
  readonly #kv: Deno.Kv;
  readonly #maxMutations: number;
  readonly #maxPayloadBytes: number;
  readonly #maxKeyBytes: number;
  readonly #maxChecks: number;
  readonly #queue: Array<{ method: MutateMethod; args: unknown[] }> = [];

  public constructor(
    kv: Deno.Kv,
    options?: {
      maxChecks?: number;
      maxMutations?: number;
      maxPayloadBytes?: number;
      maxKeyBytes?: number;
    },
  ) {
    this.#kv = kv;
    this.#maxChecks = options?.maxChecks ?? MAX_CHECKS;
    this.#maxMutations = options?.maxMutations ?? MAX_MUTATIONS;
    this.#maxPayloadBytes = options?.maxPayloadBytes ?? MAX_TOTAL_PAYLOAD_BYTES;
    this.#maxKeyBytes = options?.maxKeyBytes ?? MAX_TOTAL_KEY_BYTES;
  }

  /** set queues a key-value mutation for the next commit. */
  public set(
    key: Deno.KvKey,
    value: unknown,
    _options?: { expireIn?: number },
  ): this {
    this.#queue.push({ method: "set", args: [key, value] });
    return this;
  }

  /** delete queues a key deletion for the next commit. */
  public delete(key: Deno.KvKey): this {
    this.#queue.push({ method: "delete", args: [key] });
    return this;
  }

  /**
   * commit flushes all queued mutations across one or more
   * `Deno.Kv.atomic().commit()` calls, splitting when Deno KV per-batch
   * limits are reached.
   */
  public async commit(): Promise<(Deno.KvCommitResult | Deno.KvCommitError)[]> {
    if (this.#queue.length === 0) {
      return [];
    }

    // First build all isolated task batches in memory.
    const tasks: CommitTask[] = [];
    let currentTaskMutations: Array<{ method: MutateMethod; args: unknown[] }> =
      [];
    let mutations = 0;
    let payloadBytes = 0;
    let keyBytes = 0;

    for (const entry of this.#queue) {
      const { method, args } = entry;
      let entryKeyLen = 0;
      let entryValLen = 0;

      switch (method) {
        case "set": {
          const [key, value] = args as [Deno.KvKey, unknown];
          entryKeyLen = estimateSize(key);
          entryValLen = estimateSize(value);
          break;
        }
        case "delete": {
          const [key] = args as [Deno.KvKey];
          entryKeyLen = estimateSize(key);
          break;
        }
      }

      if (
        mutations + 1 > this.#maxMutations ||
        payloadBytes + entryKeyLen + entryValLen > this.#maxPayloadBytes ||
        keyBytes + entryKeyLen > this.#maxKeyBytes
      ) {
        if (currentTaskMutations.length > 0) {
          tasks.push({ mutations: currentTaskMutations });
          currentTaskMutations = [];
        }
        mutations = 0;
        payloadBytes = 0;
        keyBytes = 0;
      }

      currentTaskMutations.push(entry);
      mutations++;
      payloadBytes += entryKeyLen + entryValLen;
      keyBytes += entryKeyLen;
    }

    if (currentTaskMutations.length > 0) {
      tasks.push({ mutations: currentTaskMutations });
    }

    // Execute batches concurrently using pooledMap up to a target concurrency pool (e.g. 4 parallel writes)
    const concurrency = 4;
    const resultsIterator = pooledMap(
      concurrency,
      tasks,
      async (task) => {
        const operation = this.#kv.atomic();
        for (const entry of task.mutations) {
          const { method, args } = entry;
          switch (method) {
            case "set": {
              const [key, value] = args as [Deno.KvKey, unknown];
              operation.set(key, value);
              break;
            }
            case "delete": {
              const [key] = args as [Deno.KvKey];
              operation.delete(key);
              break;
            }
          }
        }
        return await operation.commit();
      },
    );

    const finalResults: (Deno.KvCommitResult | Deno.KvCommitError)[] = [];
    for await (const result of resultsIterator) {
      finalResults.push(result);
    }

    return finalResults;
  }
}

export type BatchedKvAtomic = BatchedAtomicOperation;

/**
 * commitBatchedKvMutations applies queued KV writes via the native
 * {@linkcode BatchedAtomicOperation} helper.
 */
export async function commitBatchedKvMutations(
  kv: Deno.Kv,
  applyMutations: (batch: BatchedKvAtomic) => void,
): Promise<void> {
  const batch = new BatchedAtomicOperation(kv);
  applyMutations(batch);
  const commitResults = await batch.commit();
  for (const commitResult of commitResults) {
    if (!commitResult.ok) {
      throw new Error("Deno KV batched atomic commit failed");
    }
  }
}
