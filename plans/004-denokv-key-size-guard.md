# Plan 004: Cap or hash oversized Deno KV key segments derived from RDF terms

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 73a0920..HEAD -- src/denokv/kv/denokv-keys.ts src/denokv/kv/denokv-quad-keys.ts src/denokv/kv/denokv-kv-limits.ts src/denokv/commit-patch-to-denokv.test.ts src/denokv/rdfjs-store/denokv-rdfjs-store.match.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `73a0920`, 2026-06-10
- **Issue**: none

## Why this matters

The Deno KV backend materializes RDF term values directly into key segments. One oversized subject, predicate, object, or graph value can push a key past Deno KV limits and make imports fail reliably. Because the backend is intended for durable storage of untrusted RDF data, this is a practical denial-of-service vector. The fix needs to preserve key determinism while adding a bounded representation for pathological values.

## Current state

Relevant files:
- `src/denokv/kv/denokv-keys.ts` — converts RDF terms into KV key parts and builds primary/index keys.
- `src/denokv/kv/denokv-quad-keys.ts` — combines those parts into the actual quad index keys.
- `src/denokv/kv/denokv-kv-limits.ts` — enforces batch-level limits but not single-key representation caps.
- `src/denokv/commit-patch-to-denokv.test.ts` and `src/denokv/rdfjs-store/denokv-rdfjs-store.match.test.ts` — existing Deno KV coverage where a regression test can live.

Code to anchor on:

- `src/denokv/kv/denokv-keys.ts:41-57`
  ```ts
  export function termKeyParts(term: rdfjs.Term): Deno.KvKeyPart[] {
    if (term.termType === "Literal") {
      const literalTerm = term as rdfjs.Literal;
      return [
        "Literal",
        literalTerm.value,
        literalTerm.language ?? "",
        literalTerm.datatype?.value ?? "",
      ];
    }

    if (term.termType === "DefaultGraph") {
      return ["DefaultGraph"];
    }

    return [term.termType, term.value];
  }
  ```
- `src/denokv/kv/denokv-quad-keys.ts:51-133`
  ```ts
  const subjectParts = termKeyParts(options.storedQuad.subject);
  const predicateParts = termKeyParts(options.storedQuad.predicate);
  const objectParts = termKeyParts(options.storedQuad.object);
  const graphParts = termKeyParts(options.storedQuad.graph);
  ```
- `src/denokv/kv/denokv-kv-limits.ts:1-17`
  ```ts
  * Deno KV enforces per-key value size (~64 KiB), per-atomic mutation count, and
  * per-commit total key bytes (~80 KiB) and payload size (~800 KiB); see
  * `deno/ext/kv/lib.rs`.
  ```

Repo conventions to follow:
- Keep the key-prefix and generation structure intact unless the migration path is explicit.
- Maintain the backend’s explicit helper naming and JSDoc style.
- Prefer tests that exercise real `Deno.openKv(":memory:")` behavior when possible.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `deno task check` | exit 0 |
| Deno KV tests | `deno test --allow-all --unstable-kv src/denokv/commit-patch-to-denokv.test.ts src/denokv/rdfjs-store/denokv-rdfjs-store.match.test.ts` | new guard regression passes |
| Repo gate | `deno task ci` | exit 0 |

## Scope

**In scope**:
- `src/denokv/kv/denokv-keys.ts`
- `src/denokv/kv/denokv-quad-keys.ts`
- `src/denokv/kv/denokv-kv-limits.ts` only if it needs a helper for size validation
- `src/denokv/commit-patch-to-denokv.test.ts`
- `src/denokv/rdfjs-store/denokv-rdfjs-store.match.test.ts` only if a search/match test is the best place for the regression

**Out of scope**:
- LibSQL code.
- Generation ordering changes.
- Search query expansion.

## Git workflow

- Do not commit, push, or open PRs.
- Keep the change conservative: detect or transform oversized segments, but do not redesign indexing unless the current shape cannot be made safe.

## Steps

### Step 1: Add a regression that demonstrates the oversized-key failure
Add a Deno KV test that uses an artificially long literal or IRI value and shows the current backend fails to persist or match it reliably. Use real key materialization, not a mock, so the test proves the size problem in the actual path.

**Verify**: `deno test --allow-all --unstable-kv src/denokv/commit-patch-to-denokv.test.ts src/denokv/rdfjs-store/denokv-rdfjs-store.match.test.ts` → the new test fails on current code before the fix.

### Step 2: Introduce a bounded representation for pathological term values
Implement a deterministic cap or hash strategy for RDF term segments that would otherwise exceed KV key limits. Keep short values unchanged. If the chosen approach affects existing keys, make the migration path explicit and narrow.

**Verify**: rerun the same Deno KV tests → the new regression passes and existing match/commit tests still pass.

### Step 3: Re-run the repo gate
Run the repo-wide checks.

**Verify**: `deno task ci` → exit 0.

## Test plan

- Add one oversized-term regression test.
- Keep the ordinary key-shape tests passing.
- If the chosen strategy is hash-based, add a direct test that two distinct oversized values do not collide in the same backend view.

## Done criteria

- [ ] Oversized RDF term values no longer produce unbounded KV key segments.
- [ ] The new regression test exists and passes.
- [ ] `deno task ci` exits 0.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:
- The live code no longer matches the excerpts above.
- The fix would require a full key-schema migration that cannot be safely done in the existing Deno KV adapter.
- The test can only be written by faking `termKeyParts` instead of exercising the real path.

## Maintenance notes

Any future expansion of index families or term encoding must keep a hard upper bound on key size. Reviewers should pay special attention to any new string concatenation in Deno KV key construction.
