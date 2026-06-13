# Plan 001: Make LibSQL replace imports atomic with respect to wipe + rewrite

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 73a0920..HEAD -- src/libsql/commit-patch-to-libsql.ts src/libsql/libsql-batch-executor.ts src/libsql/quad-store/libsql-quad-query-builder.ts src/libsql/commit-patch-to-libsql.test.ts`
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

A replace-mode import currently wipes LibSQL tables before the replacement rows are durable. If the process fails mid-write, the old corpus is gone and the new corpus is only partially present. This is the kind of failure that turns a transient problem into data loss. The fix should preserve the repo’s existing batch-writing style while making replace imports all-or-nothing from the caller’s point of view.

## Current state

Relevant files:
- `src/libsql/commit-patch-to-libsql.ts` — orchestrates replace-mode wipe, deletion staging, insertion staging, and final flush.
- `src/libsql/libsql-batch-executor.ts` — flushes staged statements in multiple `client.batch()` calls.
- `src/libsql/quad-store/libsql-quad-query-builder.ts` — defines the wipe statements currently used by replace imports.
- `src/libsql/commit-patch-to-libsql.test.ts` — existing LibSQL commit coverage to extend.

Code to anchor on:

- `src/libsql/commit-patch-to-libsql.ts:35-45`
  ```ts
  async function executeReplaceImportWipe(
    client: Client,
    writeBatchSize: number,
  ): Promise<void> {
    const executor = new LibsqlBatchExecutor({ client, writeBatchSize });
    await executor.stage(buildWipeAllGraphDataStatements());
    await executor.flush();
  }
  ```
- `src/libsql/commit-patch-to-libsql.ts:69-74`
  ```ts
  if (isReplaceImportCommit(context)) {
    await executeReplaceImportWipe(
      client,
      writeBatchSize,
    );
  }
  ```
- `src/libsql/libsql-batch-executor.ts:48-68`
  ```ts
  public async flush(): Promise<void> {
    if (this.statements.length === 0) {
      return;
    }

    const { client, writeBatchSize } = this.options;

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
  ```
- `src/libsql/quad-store/libsql-quad-query-builder.ts:260-266`
  ```ts
  export function buildWipeAllGraphDataStatements(): Array<
    { sql: string; args: [] }
  > {
    return [
      { sql: "DELETE FROM chunks", args: [] },
      { sql: "DELETE FROM quads", args: [] },
    ];
  }
  ```

Repo conventions to follow:
- Keep existing dense helper style and JSDoc comments on public helpers.
- Match the repo’s existing test style in `src/libsql/commit-patch-to-libsql.test.ts`: explicit fixtures, `assertEquals`, real in-memory LibSQL client.
- The public commit flow already separates staging from final flush; preserve that shape unless a stronger atomic mechanism replaces it cleanly.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `deno task check` | exit 0 |
| Tests | `deno test --allow-all --unstable-kv src/libsql/commit-patch-to-libsql.test.ts` | new regression passes |
| CI baseline | `deno task ci` | exit 0 |

## Scope

**In scope**:
- `src/libsql/commit-patch-to-libsql.ts`
- `src/libsql/libsql-batch-executor.ts` only if needed for a safer atomicity boundary
- `src/libsql/commit-patch-to-libsql.test.ts`

**Out of scope**:
- Search index semantics unrelated to replace atomicity.
- Any public response-shape changes.
- Deno KV code.

## Git workflow

- Do not commit, push, or open PRs.
- Keep edits minimal and localized.

## Steps

### Step 1: Characterize the failure window in a test
Add one regression test in `src/libsql/commit-patch-to-libsql.test.ts` that simulates replace-mode failure after the wipe has run but before all replacement writes complete. Use the existing in-memory LibSQL test setup and a deliberate failure in the commit path so the test can prove whether the old data survives an interrupted replace.

**Verify**: `deno test --allow-all --unstable-kv src/libsql/commit-patch-to-libsql.test.ts` → the new failure-path test fails on the current code before your fix, then passes after the fix.

### Step 2: Move replace-mode visibility to after durable rewrite
Change the replace path so the wipe is no longer exposed before the replacement rows are fully durable. Prefer a staged/hidden generation or a single atomic transaction if the backend supports it cleanly. Keep the current staging helpers if they still make sense, but do not leave the database in a wiped state until success is assured.

**Verify**: `deno test --allow-all --unstable-kv src/libsql/commit-patch-to-libsql.test.ts` → all LibSQL commit tests pass, including the new regression.

### Step 3: Re-run the repo gate
Run the repo’s standard checks and make sure nothing else regressed.

**Verify**: `deno task ci` → exit 0.

## Test plan

- Add one negative-path test for interrupted replace imports.
- Keep existing happy-path replace tests intact.
- If a stronger atomic transaction requires a new test helper, add it beside the current LibSQL test fixtures.

## Done criteria

- [ ] Replace-mode imports no longer expose a wiped corpus before the replacement is durable.
- [ ] The new regression test exists and passes.
- [ ] `deno task ci` exits 0.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:
- The live code no longer matches the excerpts above.
- The only safe fix requires touching search-index code or changing public APIs.
- The regression cannot be expressed without a brittle mock that does not exercise the real replace path.

## Maintenance notes

Future changes to LibSQL batching or search projection should re-check the replace path first. Reviewers should pay attention to any code that makes the wipe visible before the full write set is committed.
