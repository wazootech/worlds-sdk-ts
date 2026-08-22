import type * as rdfjs from "@rdfjs/types";
import type { WorldsSdkInterface } from "@/client/client.ts";
import {
  type ImportRequest,
  materializeImportQuads,
} from "@/client/quad-store/mod.ts";
import type { SearchResult } from "@/client/search-index/mod.ts";
import type {
  SparqlBinding,
  SparqlResponse,
  SparqlValue,
} from "@/client/sparql-engine/mod.ts";
import {
  parityCorpus,
  type ParityFixture,
  type ParityReplaceCase,
  type ParitySearchCase,
  type ParitySparqlCase,
} from "./parity-fixtures.ts";

const NQUADS = "application/n-quads";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** WorldsSdkFactory constructs a fresh WorldsSdk (quad store + search + SPARQL wired) for one case. */
export type WorldsSdkFactory = () => Promise<WorldsSdkInterface> | WorldsSdkInterface;

/** ParitySuiteOptions configures a parity run: the reference, the candidate, and the corpus. */
export interface ParitySuiteOptions {
  /**
   * reference is the known-good WorldsSdk (libsql-backed) that candidates must
   * match — the "parity vs libsql" baseline per the shared suite definition.
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

async function runFixtureCase(
  options: ParitySuiteOptions,
  fixture: ParityFixture,
): Promise<ParityCaseResult> {
  const failures: string[] = [];
  const notes: string[] = [];

  try {
    const ref = await options.reference();
    const cand = await options.candidate();
    await importNquads(ref, fixture.nquads);
    await importNquads(cand, fixture.nquads);

    await checkQuadCounts(
      fixture.name,
      ref,
      cand,
      fixture.totalQuads,
      failures,
    );
    await checkGraphSizes(fixture.name, cand, fixture.graphSizes, failures);
    await checkRoundTrip(
      fixture.name,
      options.candidate,
      fixture.nquads,
      failures,
    );

    for (const searchCase of fixture.search ?? []) {
      await checkSearchCase(
        fixture.name,
        options,
        fixture.nquads,
        searchCase,
        options.strictSearchOrder ?? true,
        failures,
      );
    }

    for (const sparqlCase of fixture.sparql ?? []) {
      await checkSparqlCase(
        fixture.name,
        options,
        fixture.nquads,
        sparqlCase,
        failures,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`threw: ${message}`);
  }

  if (fixture.gate === "declared") {
    // Declared corpus categories are reported but never fail the suite until
    // the reference (libsql) supports them (e.g. RDF-star storage).
    if (failures.length > 0) {
      notes.push(...failures);
      failures.length = 0;
    }
  }

  return {
    name: fixture.name,
    ok: failures.length === 0,
    failures,
    notes: notes.length > 0 ? notes : undefined,
  };
}

async function runReplaceCase(
  options: ParitySuiteOptions,
  replaceCase: ParityReplaceCase,
): Promise<ParityCaseResult> {
  const failures: string[] = [];
  try {
    const firstCount = await countNquads(replaceCase.first);
    for (
      const [label, factory] of [
        ["reference", options.reference],
        ["candidate", options.candidate],
      ] as const
    ) {
      const sdk = await factory();
      await importNquads(sdk, replaceCase.first, "replace");
      const afterFirst = await exportQuads(sdk);
      if (afterFirst.length !== firstCount) {
        failures.push(
          `[${replaceCase.name}] ${label} after first replace: ` +
            `${afterFirst.length} quads != expected ${firstCount}`,
        );
      }

      await importNquads(sdk, replaceCase.second, "replace");
      const afterSecond = await exportQuads(sdk);
      if (afterSecond.length !== replaceCase.resultCount) {
        failures.push(
          `[${replaceCase.name}] ${label} after second replace: ` +
            `${afterSecond.length} quads != expected ${replaceCase.resultCount}`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`threw: ${message}`);
  }
  return { name: replaceCase.name, ok: failures.length === 0, failures };
}

async function checkQuadCounts(
  fixtureName: string,
  ref: WorldsSdkInterface,
  cand: WorldsSdkInterface,
  expected: number,
  failures: string[],
): Promise<void> {
  for (
    const [label, sdk] of [
      ["reference", ref],
      ["candidate", cand],
    ] as const
  ) {
    const quads = await exportQuads(sdk);
    if (quads.length !== expected) {
      failures.push(
        `[${fixtureName}] ${label} quad count ${quads.length} != expected ${expected}`,
      );
    }
  }
}

async function checkGraphSizes(
  fixtureName: string,
  sdk: WorldsSdkInterface,
  expected: Record<string, number> | undefined,
  failures: string[],
): Promise<void> {
  if (!expected) return;
  const quads = await exportQuads(sdk);
  const sizes = new Map<string, number>();
  for (const quad of quads) {
    const graph = quad.graph.value;
    sizes.set(graph, (sizes.get(graph) ?? 0) + 1);
  }
  for (const [graph, count] of Object.entries(expected)) {
    if ((sizes.get(graph) ?? 0) !== count) {
      failures.push(
        `[${fixtureName}] candidate graph ${JSON.stringify(graph)} ` +
          `has ${sizes.get(graph) ?? 0} quads != expected ${count}`,
      );
    }
  }
}

/**
 * checkRoundTrip verifies that exporting a world and re-importing the
 * exported serialization yields byte-identical serializations (idempotent
 * round-trip) on the candidate's own engine.
 */
async function checkRoundTrip(
  fixtureName: string,
  candidateFactory: WorldsSdkFactory,
  nquads: string,
  failures: string[],
): Promise<void> {
  const sdk1 = await candidateFactory();
  await importNquads(sdk1, nquads);
  const out1 = await exportSerialized(sdk1);

  const sdk2 = await candidateFactory();
  await importNquads(sdk2, out1.data);
  const out2 = await exportSerialized(sdk2);

  if (out1.data !== out2.data) {
    failures.push(
      `[${fixtureName}] candidate serialized export is not round-trip idempotent`,
    );
  }
}

async function checkSearchCase(
  fixtureName: string,
  options: ParitySuiteOptions,
  nquads: string,
  searchCase: ParitySearchCase,
  strictOrder: boolean,
  failures: string[],
): Promise<void> {
  const ref = await options.reference();
  const cand = await options.candidate();
  await importNquads(ref, nquads);
  await importNquads(cand, nquads);

  const refResults = (await ref.search(searchCase.request)).results ?? [];
  const candResults = (await cand.search(searchCase.request)).results ?? [];

  const refKeys = refResults.map(searchResultKey);
  const candKeys = candResults.map(searchResultKey);

  const equal = strictOrder
    ? sequenceEqual(refKeys, candKeys)
    : multisetEqual(refKeys, candKeys);

  if (!equal) {
    failures.push(
      `[${fixtureName}] search case "${searchCase.name}": ` +
        `candidate results differ from reference (query=${
          JSON.stringify(searchCase.request.query)
        })`,
    );
  }
}

async function checkSparqlCase(
  fixtureName: string,
  options: ParitySuiteOptions,
  nquads: string,
  sparqlCase: ParitySparqlCase,
  failures: string[],
): Promise<void> {
  const ref = await options.reference();
  const cand = await options.candidate();
  await importNquads(ref, nquads);
  await importNquads(cand, nquads);

  const refResponse = await ref.sparql({ query: sparqlCase.query });
  const candResponse = await cand.sparql({ query: sparqlCase.query });

  checkSparqlAgainstExpectation(
    fixtureName,
    sparqlCase.name,
    "reference",
    refResponse,
    sparqlCase.expected,
    failures,
  );
  checkSparqlAgainstExpectation(
    fixtureName,
    sparqlCase.name,
    "candidate",
    candResponse,
    sparqlCase.expected,
    failures,
  );
  checkSparqlEquivalence(
    fixtureName,
    sparqlCase.name,
    refResponse,
    candResponse,
    failures,
  );
}

function checkSparqlAgainstExpectation(
  fixtureName: string,
  caseName: string,
  label: "reference" | "candidate",
  response: SparqlResponse,
  expected: ParitySparqlCase["expected"],
  failures: string[],
): void {
  if (expected.kind === "ask") {
    if (response.kind !== "ask") {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}" (${label}): expected ask, got ${response.kind}`,
      );
      return;
    }
    if (response.data.boolean !== expected.boolean) {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}" (${label}): ` +
          `ask ${response.data.boolean} != expected ${expected.boolean}`,
      );
    }
    return;
  }

  if (expected.kind === "select") {
    if (response.kind !== "select") {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}" (${label}): expected select, got ${response.kind}`,
      );
      return;
    }
    const got = response.data.results.bindings.map(bindingKey).sort();
    const want = expected.bindings.map(bindingKey).sort();
    if (!sequenceEqual(got, want)) {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}" (${label}): ` +
          `bindings differ from expected (query=${JSON.stringify(caseName)})`,
      );
    }
  }
}

function checkSparqlEquivalence(
  fixtureName: string,
  caseName: string,
  refResponse: SparqlResponse,
  candResponse: SparqlResponse,
  failures: string[],
): void {
  if (refResponse.kind !== candResponse.kind) {
    failures.push(
      `[${fixtureName}] SPARQL "${caseName}": response kinds differ ` +
        `(${refResponse.kind} vs ${candResponse.kind})`,
    );
    return;
  }
  if (refResponse.kind === "ask" && candResponse.kind === "ask") {
    if (refResponse.data.boolean !== candResponse.data.boolean) {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}": ask results differ between reference and candidate`,
      );
    }
    return;
  }

  if (refResponse.kind === "select" && candResponse.kind === "select") {
    const refBindings = refResponse.data.results.bindings.map(bindingKey)
      .sort();
    const candBindings = candResponse.data.results.bindings.map(bindingKey)
      .sort();
    if (!sequenceEqual(refBindings, candBindings)) {
      failures.push(
        `[${fixtureName}] SPARQL "${caseName}": bindings differ between reference and candidate`,
      );
    }
  }
}

async function exportQuads(sdk: WorldsSdkInterface): Promise<rdfjs.Quad[]> {
  const response = await sdk.export({ format: { kind: "quads" } });
  if (response.kind !== "quads") {
    throw new Error("export did not return quads");
  }
  return response.quads;
}

async function exportSerialized(
  sdk: WorldsSdkInterface,
): Promise<{ data: string; contentType: string }> {
  const response = await sdk.export({
    format: { kind: "serialized", contentType: NQUADS },
  });
  if (response.kind !== "serialized") {
    throw new Error("export did not return serialized data");
  }
  return { data: response.data, contentType: response.contentType };
}

async function importNquads(
  sdk: WorldsSdkInterface,
  nquads: string,
  mode: ImportRequest["mode"] = "merge",
): Promise<void> {
  await sdk.import({
    mode,
    source: { kind: "serialized", data: nquads, contentType: NQUADS },
  });
}

async function countNquads(nquads: string): Promise<number> {
  const quads = await materializeImportQuads({
    kind: "serialized",
    data: nquads,
    contentType: NQUADS,
  });
  return quads.length;
}

function searchResultKey(result: SearchResult): string {
  return JSON.stringify({
    id: result.id,
    subject: result.subject,
    predicate: result.predicate,
    graph: result.graph,
    text: result.text,
  });
}

/** bindingKey canonicalizes a SPARQL binding (order-insensitive key comparison). */
function bindingKey(binding: SparqlBinding): string {
  const entries = Object.keys(binding).sort().map((variable) => {
    return `${variable}=${valueKey(binding[variable])}`;
  });
  return `{${entries.join(", ")}}`;
}

function valueKey(value: SparqlValue): string {
  switch (value.type) {
    case "uri":
    case "bnode":
      return `${value.type}:${value.value}`;
    case "literal": {
      let key = `literal:${value.value}`;
      if (value["xml:lang"]) key += `@${value["xml:lang"]}`;
      if (value.datatype && value.datatype !== XSD_STRING) {
        key += `^^${value.datatype}`;
      }
      if (value["its:dir"]) key += `[${value["its:dir"]}]`;
      return key;
    }
    case "triple":
      return `triple(${valueKey(value.value.subject)}, ` +
        `${valueKey(value.value.predicate)}, ${valueKey(value.value.object)})`;
  }
}

function sequenceEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of b) {
    const remaining = (counts.get(value) ?? 0) - 1;
    if (remaining < 0) return false;
    counts.set(value, remaining);
  }
  return true;
}
