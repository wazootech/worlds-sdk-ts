import type { SparqlResponse } from "@/client/sparql-engine/mod.ts";
import type { ParitySparqlCase } from "./parity-fixtures.ts";
import { bindingKey, importNquads, sequenceEqual } from "./parity-helpers.ts";
import type { ParitySuiteOptions } from "./parity-types.ts";

export async function checkSparqlCase(
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
