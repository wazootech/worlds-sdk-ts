# Plan 005: Put a hard limit on search filter expansion before SQL generation

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 73a0920..HEAD -- src/libsql/search-index/libsql-search-query-builder.ts src/client/client.ts src/libsql/search-index/libsql-search-query-builder.test.ts src/client/client.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S/M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `73a0920`, 2026-06-10
- **Issue**: none

## Why this matters

The LibSQL search path turns every include/exclude list into a literal `IN (...)` or `NOT IN (...)` clause with one placeholder per value. That makes the SQL text and parameter list grow linearly with untrusted input size. A caller can use that to push CPU and memory up, or simply force the query to fail when the list gets too large. The fix should keep the current query-builder style for normal cases while setting a clear ceiling for pathological inputs.

## Current state

Relevant files:
- `src/libsql/search-index/libsql-search-query-builder.ts` — builds the parameterized SQL for search filters.
- `src/client/client.ts` — forwards `SearchRequest` directly to the search index.
- `src/libsql/search-index/libsql-search-query-builder.test.ts` — existing query-builder coverage.
- `src/client/client.test.ts` if it exists and is the better place to assert API-level rejection.

Code to anchor on:

- `src/libsql/search-index/libsql-search-query-builder.ts:83-134`
  ```ts
  function buildIncludeExcludeFilterClauses(
    filter: QuadFilter | undefined,
    columnMapping: ColumnMapping,
  ): { whereClauses: string[]; filterArgs: string[] } {
    const whereClauses: string[] = [];
    const filterArgs: string[] = [];

    const filterConfigurations = [
      ...
    ] as const;

    for (const { values, column, operator } of filterConfigurations) {
      if (values?.length) {
        const placeholders = generatePlaceholders(values.length);
        whereClauses.push(`${column} ${operator} (${placeholders})`);
        filterArgs.push(...values);
      }
    }

    return { whereClauses, filterArgs };
  }
  ```
- `src/client/client.ts:104-109`
  ```ts
  public search(request: SearchRequest): Promise<SearchResponse> {
    if (!this.options.searchIndex) {
      throw new Error("Search index is not configured.");
    }
    return this.options.searchIndex.search(request);
  }
  ```

Repo conventions to follow:
- Keep the query builder parameterized; do not regress to string interpolation.
- Use the existing `QuadFilter`/`SearchRequest` shapes.
- Existing tests favor exact SQL-shape assertions on the builder; keep that style and add one boundary test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `deno task check` | exit 0 |
| Query-builder tests | `deno test --allow-all --unstable-kv src/libsql/search-index/libsql-search-query-builder.test.ts` | new boundary test passes |
| Repo gate | `deno task ci` | exit 0 |

## Scope

**In scope**:
- `src/libsql/search-index/libsql-search-query-builder.ts`
- `src/client/client.ts` only if the public API should reject oversized filters before query generation
- `src/libsql/search-index/libsql-search-query-builder.test.ts`
- `src/client/client.test.ts` only if needed for the public rejection path

**Out of scope**:
- Deno KV code.
- Any change to search result shapes.
- SPARQL result materialization.

## Git workflow

- Do not commit, push, or open PRs.
- Keep the chosen limit obvious and documented.

## Steps

### Step 1: Add a regression for oversized filter arrays
Write a test that passes a deliberately huge include or exclude list and asserts the current behavior is unacceptable. Depending on where you place the guard, the test should either expect the builder to reject the request or the public client API to reject it before the builder is called.

**Verify**: `deno test --allow-all --unstable-kv src/libsql/search-index/libsql-search-query-builder.test.ts` (and `src/client/client.test.ts` if used) → the new test fails on current code and passes after the fix.

### Step 2: Enforce a hard ceiling before SQL expansion
Add a cap on the number of filter values accepted per search dimension, and make the failure message explicit. Keep the normal SQL generation path unchanged for valid sizes.

**Verify**: rerun the same targeted tests → all pass.

### Step 3: Re-run the repo gate
Run the repo-wide checks.

**Verify**: `deno task ci` → exit 0.

## Test plan

- Add one oversized-filter boundary test.
- Keep the existing SQL-shape tests for ordinary inputs.
- If the rejection lives in `client.ts`, add one API-level test so the public boundary is covered, not just the query builder.

## Done criteria

- [ ] Oversized include/exclude filter lists are rejected before SQL expansion.
- [ ] The new regression test exists and passes.
- [ ] `deno task ci` exits 0.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:
- The live code no longer matches the excerpts above.
- The fix would require replacing the SQL builder entirely.
- The public API shape must change in a way that needs separate user approval.

## Maintenance notes

If search semantics later move to temp tables or joins, revisit the size cap and tests together. Reviewers should look for any path that can still expand unbounded arrays into SQL text.
