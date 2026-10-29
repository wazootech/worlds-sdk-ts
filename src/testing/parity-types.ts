import type { WorldsSdkInterface } from "@/client/client.ts";
import type { ParityFixture, ParityReplaceCase } from "./parity-fixtures.ts";

/** WorldsSdkFactory constructs a fresh WorldsSdk (quad store + search + SPARQL wired) for one case. */
export type WorldsSdkFactory = () =>
  | Promise<WorldsSdkInterface>
  | WorldsSdkInterface;

/** ParitySuiteOptions configures a parity run: the reference, the candidate, and the corpus. */
export interface ParitySuiteOptions {
  /**
   * reference is the known-good WorldsSdk that candidates must match — the
   * parity baseline per the shared suite definition. Backend suites pin
   * `createMemoryWorldsSdk` (the portable in-memory reference); durable
   * source-of-truth status lives in ARCHITECTURE.md, not in this option.
   */
  reference: WorldsSdkFactory;

  /** candidate is the backend under test. */
  candidate: WorldsSdkFactory;

  /** fixtures overrides the corpus fixtures (defaults to parityCorpus.fixtures). */
  fixtures?: ParityFixture[];

  /** replaceCases overrides the corpus replace cases (defaults to parityCorpus.replaceCases). */
  replaceCases?: ParityReplaceCase[];

  /**
   * strictSearchOrder enforces top-K result ordering equality between the
   * reference and the candidate (default true — top-K ordering is part of the
   * parity contract). Set false to compare result sets order-insensitively.
   */
  strictSearchOrder?: boolean;
}

/** ParityCaseResult is one fixture or replace case's verdict. */
export interface ParityCaseResult {
  /** name is the fixture or replace-case name. */
  name: string;
  /** ok is true when the case passed (declared-gate cases never fail the suite). */
  ok: boolean;
  /** failures lists concrete mismatches. */
  failures: string[];
  /** notes records informational observations (e.g. declared-gate skips). */
  notes?: string[];
}

/** ParityReport aggregates every case in the run. */
export interface ParityReport {
  /** ok is true when every case passed. */
  ok: boolean;
  /** results is one entry per fixture and replace case. */
  results: ParityCaseResult[];
}
