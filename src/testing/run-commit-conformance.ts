import type { CaseContext } from "./commit-conformance-support.ts";
import type { CommitConformanceSuiteOptions } from "./commit-conformance-types.ts";
import {
  deleteAndReinsertCase,
  embeddingFailureCase,
  replaceFailureCase,
  writeFailureCase,
} from "./commit-conformance-failure-cases.ts";
import {
  defaultModeCase,
  deferredCase,
  disabledCase,
  idempotentCase,
  incrementalCase,
} from "./commit-conformance-mode-cases.ts";
import { laterWriteFailureCase } from "./commit-conformance-later-write-case.ts";
import type { ParityCaseResult, ParityReport } from "./parity-types.ts";

/** conformanceCases lists every case; the key is the name reported on failure. */
const conformanceCases: Array<[string, (ctx: CaseContext) => Promise<void>]> = [
  ["incremental import projects chunks", incrementalCase],
  ["disabled import writes no chunks", disabledCase],
  ["deferred import rebuilds once", deferredCase],
  ["default mode matches the contract", defaultModeCase],
  ["re-writing a stored quad is idempotent", idempotentCase],
  ["delete and re-insert keeps the quad", deleteAndReinsertCase],
  ["embedding failure follows the contract", embeddingFailureCase],
  ["write failure leaves no orphan chunks", writeFailureCase],
  ["replace-import failure follows the contract", replaceFailureCase],
  ["later-write failure follows the contract", laterWriteFailureCase],
];

/**
 * runCommitConformanceSuite checks one backend's commit and search-projection
 * behavior against the shared contract: the `searchIndexOnImport` modes, the
 * default mode, idempotent and delete-then-re-add writes, and what an embedding
 * failure, a failed write, a failed replace import, and a failed later write
 * (after the quad writes) leave behind.
 *
 * The later-write case needs the optional subject hook `failLaterWrite`. A
 * subject without it keeps all other cases unchanged: the case is left out of
 * `results` and the reason is added to `report.notes`.
 *
 * Each case runs on a fresh subject from `options.create`. The result has the
 * same shape as `runParitySuite`'s report: assert `report.ok`, and print
 * `failures` per case when it is false. A case that throws unexpectedly fails.
 */
export async function runCommitConformanceSuite(
  options: CommitConformanceSuiteOptions,
): Promise<ParityReport> {
  const results: ParityCaseResult[] = [];
  const notes: string[] = [];
  for (const [name, run] of conformanceCases) {
    const failures: string[] = [];
    const skipped: string[] = [];
    const ctx: CaseContext = {
      ...options,
      fail: (m) => failures.push(m),
      skip: (note) => skipped.push(note),
    };
    try {
      await run(ctx);
    } catch (error) {
      failures.push(
        `threw unexpectedly: ${(error as Error)?.message ?? error}`,
      );
    }
    if (skipped.length > 0 && failures.length === 0) {
      notes.push(...skipped.map((note) => `${name}: ${note}`));
      continue;
    }
    results.push({ name, ok: failures.length === 0, failures });
  }
  return {
    ok: results.every((r) => r.ok),
    results,
    ...(notes.length && { notes }),
  };
}
