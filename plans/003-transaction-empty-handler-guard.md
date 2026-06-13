# Plan 003: Make Transaction.commit fail fast when no persistence handler exists

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 73a0920..HEAD -- src/client/quad-store/transaction.ts src/client/quad-store/import-export-via-transaction.ts src/client/quad-store/import-export-via-transaction.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `73a0920`, 2026-06-10
- **Issue**: none

## Why this matters

A Transaction can currently be constructed without either a `commit` or `fallbackCommit` handler. If a caller then buffers quads and calls `commit()`, the buffers are cleared even though nothing was persisted. That is a silent data-loss footgun. The fix should make the configuration error obvious immediately and keep the transaction state intact when misconfigured.

## Current state

Relevant files:
- `src/client/quad-store/transaction.ts` — commit path and buffer clearing.
- `src/client/quad-store/import-export-via-transaction.ts` — caller that expects commit failures to roll back cleanly.
- `src/client/quad-store/import-export-via-transaction.test.ts` — existing import/commit coverage.

Code to anchor on:

- `src/client/quad-store/transaction.ts:20-31`
  ```ts
  export interface TransactionOptions {
    /** commit persists the deduplicated patch. */
    commit?: (
      patch: import("./patch.ts").Patch,
      context?: TransactionContext,
    ) => Promise<void>;

    /** fallbackCommit runs when commit is omitted. */
    fallbackCommit?: (
      patch: import("./patch.ts").Patch,
      context?: TransactionContext,
    ) => Promise<void>;
  }
  ```
- `src/client/quad-store/transaction.ts:112-131`
  ```ts
  public async commit(context?: TransactionContext): Promise<void> {
    deduplicateBuffers(this.insertBuffer, this.deleteBuffer);

    if (this.insertBuffer.length === 0 && this.deleteBuffer.length === 0) {
      return;
    }

    const patch = {
      insertions: this.insertBuffer,
      deletions: this.deleteBuffer,
    };

    if (this.options.commit) {
      await this.options.commit(patch, context);
    } else if (this.options.fallbackCommit) {
      await this.options.fallbackCommit(patch, context);
    }

    this.clearBuffer();
  }
  ```
- `src/client/quad-store/import-export-via-transaction.ts:34-43`
  ```ts
  const tx = options.createTransaction();
  try {
    for (const quad of quads) {
      tx.addQuad(quad);
    }
    await tx.commit({ importMode: mode });
  } catch (error) {
    tx.rollback();
    throw error;
  }
  ```

Repo conventions to follow:
- Existing transaction code is small and explicit; keep the fix similarly direct.
- Existing tests in `src/client/quad-store/import-export-via-transaction.test.ts` use simple in-memory fixtures and plain `assertEquals`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `deno task check` | exit 0 |
| Tests | `deno test --allow-all --unstable-kv src/client/quad-store/import-export-via-transaction.test.ts` | new guard regression passes |
| Repo gate | `deno task ci` | exit 0 |

## Scope

**In scope**:
- `src/client/quad-store/transaction.ts`
- `src/client/quad-store/import-export-via-transaction.ts` only if it needs a better error type/message
- `src/client/quad-store/import-export-via-transaction.test.ts`

**Out of scope**:
- Durable backend implementations.
- Any change to the transaction buffer API.

## Git workflow

- Do not commit, push, or open PRs.
- Keep the configuration guard and tests small.

## Steps

### Step 1: Add a guard test for the misconfigured transaction path
Write a regression test that constructs a Transaction with neither handler, buffers a quad, and asserts that `commit()` throws a configuration error instead of silently clearing state. If you need a helper to observe the buffers indirectly, keep it local to the test file.

**Verify**: `deno test --allow-all --unstable-kv src/client/quad-store/import-export-via-transaction.test.ts` → the new test fails on current code and passes after the fix.

### Step 2: Make commit refuse to run without a handler
Update `Transaction.commit()` so it throws before deduplication or buffer clearing when both handlers are absent. Keep the success path unchanged for the configured cases.

**Verify**: `deno test --allow-all --unstable-kv src/client/quad-store/import-export-via-transaction.test.ts` → all transaction tests pass.

### Step 3: Re-run the repo gate
Run the repo-wide checks.

**Verify**: `deno task ci` → exit 0.

## Test plan

- Add one guard regression for the missing-handler configuration.
- Keep the existing import-mode and rollback coverage untouched.
- If you change the thrown message, make the test assert the semantic condition rather than an exact prose sentence.

## Done criteria

- [ ] `Transaction.commit()` throws if neither handler is configured.
- [ ] The new regression test exists and passes.
- [ ] `deno task ci` exits 0.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:
- The live code no longer matches the excerpts above.
- The fix would force a wider API redesign.
- The regression can only be written with invasive introspection into private fields.

## Maintenance notes

Any future transaction abstraction should keep configuration errors loud. Reviewers should watch for other code paths that construct `Transaction` with partial options.
