# Plan 002: Serialize Deno KV batch writes and expose generation only after success

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 73a0920..HEAD -- src/denokv/commit-patch-to-denokv.ts src/denokv/kv/denokv-kv-limits.ts src/denokv/kv/denokv-dataset-generation.ts src/denokv/commit-patch-to-denokv.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `73a0920`, 2026-06-10
- **Issue**: none

## Why this matters

The Deno KV path currently bumps the active generation before replacement data is fully written, and its batch helper executes split writes concurrently. That means a failure can point readers at an empty or partial generation, and concurrent batch execution can reorder queued mutations. This plan makes the durable write path strictly ordered and keeps the active generation pointer hidden until the rewrite succeeds.

## Current state

Relevant files:
- `src/denokv/commit-patch-to-denokv.ts` — replace/import orchestration and generation bump.
- `src/denokv/kv/denokv-kv-limits.ts` — batch splitter and concurrent commit execution.
- `src/denokv/kv/denokv-dataset-generation.ts` — active generation pointer helpers.
- `src/denokv/commit-patch-to-denokv.test.ts` — current Deno KV coverage.

Code to anchor on:

- `src/denokv/commit-patch-to-denokv.ts:69-91`
  ```ts
  async function commitReplaceImportPatch(
    patch: Patch,
    kv: Deno.Kv,
    keyPrefix: Deno.KvKey,
    enabledIndexes: readonly DenokvQuadIndex[],
  ): Promise<void> {
    const generationId = await bumpDatasetGeneration(kv, keyPrefix);
    const scopedDataPrefix = buildGenerationDataPrefix(keyPrefix, generationId);
    const insertMutations = await buildKvInsertMutations(
      scopedDataPrefix,
      enabledIndexes,
      patch.insertions,
    );

    if (insertMutations.length > 0) {
      await commitBatchedKvMutations(kv, (batch: BatchedAtomicOperation) => {
        for (const { key, value } of insertMutations) {
          batch.set(key, value);
        }
      });
    }

    await garbageCollectOrphanedGenerations(kv, keyPrefix);
  }
  ```
- `src/denokv/kv/denokv-kv-limits.ts:186-217`
  ```ts
  // Execute batches concurrently using pooledMap up to a target concurrency pool (e.g. 4 parallel writes)
  const concurrency = 4;
  const resultsIterator = pooledMap(
    concurrency,
    tasks,
    async (task) => {
      const operation = this.#kv.atomic();
      ...
      return await operation.commit();
    },
  );
  ```
- `src/denokv/kv/denokv-dataset-generation.ts:24-41`
  ```ts
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
  ```
- `src/denokv/commit-patch-to-denokv.test.ts` currently only checks basic insert/delete/replace success.

Repo conventions to follow:
- Preserve the generation-scoped prefix shape and explicit helper naming.
- Keep Deno KV tests in `src/denokv/commit-patch-to-denokv.test.ts` with local `Deno.openKv(":memory:")` fixtures.
- Existing code uses explicit no-op and happy-path assertions; add a failure-path regression without over-mocking.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `deno task check` | exit 0 |
| Deno KV tests | `deno test --allow-all --unstable-kv src/denokv/commit-patch-to-denokv.test.ts` | new regression passes |
| Repo gate | `deno task ci` | exit 0 |

## Scope

**In scope**:
- `src/denokv/commit-patch-to-denokv.ts`
- `src/denokv/kv/denokv-kv-limits.ts`
- `src/denokv/kv/denokv-dataset-generation.ts` only if helper shape must change
- `src/denokv/commit-patch-to-denokv.test.ts`

**Out of scope**:
- LibSQL code.
- Search index code.
- Any public API shape changes unless absolutely necessary.

## Git workflow

- Do not commit, push, or open PRs.
- Prefer one focused fix over several unrelated durability changes.

## Steps

### Step 1: Prove the ordering bug with a regression test
Add a test that forces one split batch to fail after an earlier batch has already committed, then asserts the active generation is not exposed as a successful replace state. The test should use real Deno KV in-memory storage and the existing replace-mode commit path.

**Verify**: `deno test --allow-all --unstable-kv src/denokv/commit-patch-to-denokv.test.ts` → the new regression fails on the current implementation and passes after the fix.

### Step 2: Serialize batch commits and delay visibility
Change `BatchedAtomicOperation.commit()` so queued batches are executed in queue order, not concurrently. Then change replace-mode handling so the active generation pointer is only advanced or made authoritative after all writes for the new generation succeed, and incomplete generations are cleaned up before exposure.

**Verify**: `deno test --allow-all --unstable-kv src/denokv/commit-patch-to-denokv.test.ts` → all Deno KV commit tests pass.

### Step 3: Re-run the repo gate
Run the repository-wide checks.

**Verify**: `deno task ci` → exit 0.

## Test plan

- Add one failure-path replace test.
- Keep the existing success tests for insert, delete, replace, and empty patch.
- If serializing the batch helper changes timing, add a test that proves writes remain in queue order by observing the committed key set.

## Done criteria

- [ ] Replace imports never expose a generation before all writes for that generation succeed.
- [ ] Batch commits happen in queue order.
- [ ] The new regression test exists and passes.
- [ ] `deno task ci` exits 0.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:
- The live code no longer matches the excerpts above.
- A safe fix requires redesigning the Deno KV schema beyond generation ordering.
- The failure can only be simulated with a mock that does not exercise real Deno KV writes.

## Maintenance notes

Any future Deno KV migration or index-shape change must preserve write ordering first and visibility second. Reviewers should inspect any use of pooled/concurrent KV commits very carefully.
