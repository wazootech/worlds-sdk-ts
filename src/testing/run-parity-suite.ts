import { parityCorpus } from "./parity-fixtures.ts";
import { runFixtureCase, runReplaceCase } from "./parity-cases.ts";
import type {
  ParityCaseResult,
  ParityReport,
  ParitySuiteOptions,
} from "./parity-types.ts";

export type {
  ParityCaseResult,
  ParityReport,
  ParitySuiteOptions,
  WorldsSdkFactory,
} from "./parity-types.ts";

/**
 * runParitySuite verifies a candidate durable backend against a reference
 * WorldsSdk on the shared fixture corpus. Every fixture is imported into a fresh
 * pair of WorldsSdks, then checked for: exact quad counts, per-graph counts,
 * idempotent serialized export round-trips, SPARQL results against
 * hand-authored expectations (both WorldsSdks), and search results compared to the
 * reference (order-sensitive by default). See the shared parity/benchmark
 * suite definition (wazootech/workspace#72).
 */
export async function runParitySuite(
  options: ParitySuiteOptions,
): Promise<ParityReport> {
  const fixtures = options.fixtures ?? parityCorpus.fixtures;
  const replaceCases = options.replaceCases ?? parityCorpus.replaceCases;
  const results: ParityCaseResult[] = [];

  for (const fixture of fixtures) {
    results.push(await runFixtureCase(options, fixture));
  }
  for (const replaceCase of replaceCases) {
    results.push(await runReplaceCase(options, replaceCase));
  }

  return { ok: results.every((result) => result.ok), results };
}
