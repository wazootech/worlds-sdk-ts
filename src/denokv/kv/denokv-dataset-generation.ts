/**
 * buildDatasetGenerationKey returns the KV key for the active dataset generation pointer.
 */
export function buildDatasetGenerationKey(keyPrefix: Deno.KvKey): Deno.KvKey {
  return [...keyPrefix, "meta", "generation"];
}

/**
 * readActiveGeneration returns the current dataset generation id (0 when unset).
 */
export async function readActiveGeneration(
  kv: Deno.Kv,
  keyPrefix: Deno.KvKey,
): Promise<number> {
  const generationEntry = await kv.get<number>(
    buildDatasetGenerationKey(keyPrefix),
  );
  return generationEntry.value ?? 0;
}

/**
 * bumpDatasetGeneration atomically increments the dataset generation and returns the new id.
 */
export async function bumpDatasetGeneration(
  kv: Deno.Kv,
  keyPrefix: Deno.KvKey,
): Promise<number> {
  const generationKey = buildDatasetGenerationKey(keyPrefix);

  for (;;) {
    const currentEntry = await kv.get<number>(generationKey);
    const nextGeneration = (currentEntry.value ?? 0) + 1;
    const commitResult = await kv.atomic()
      .check(currentEntry)
      .set(generationKey, nextGeneration)
      .commit();

    if (commitResult.ok) {
      return nextGeneration;
    }
  }
}

const MAX_GARBAGE_COLLECT_ATOMIC_MUTATIONS = 200;

/**
 * garbageCollectOrphanedGenerations deletes KV rows for generations below the active pointer.
 */
export async function garbageCollectOrphanedGenerations(
  kv: Deno.Kv,
  keyPrefix: Deno.KvKey,
): Promise<void> {
  const activeGeneration = await readActiveGeneration(kv, keyPrefix);

  for (
    let generationId = 0;
    generationId < activeGeneration;
    generationId += 1
  ) {
    const generationPrefix: Deno.KvKey = [...keyPrefix, "g", generationId];
    let atomic = kv.atomic();
    let mutationCount = 0;

    for await (const entry of kv.list({ prefix: generationPrefix })) {
      atomic.delete(entry.key);
      mutationCount += 1;

      if (mutationCount >= MAX_GARBAGE_COLLECT_ATOMIC_MUTATIONS) {
        await atomic.commit();
        atomic = kv.atomic();
        mutationCount = 0;
      }
    }

    if (mutationCount > 0) {
      await atomic.commit();
    }
  }
}
