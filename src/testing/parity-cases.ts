import type { ParityFixture, ParityReplaceCase } from "./parity-fixtures.ts";
import {
  checkGraphSizes,
  checkQuadCounts,
  checkRoundTrip,
  checkSearchCase,
} from "./parity-checks.ts";
import { checkSparqlCase } from "./parity-sparql.ts";
import { countNquads, exportQuads, importNquads } from "./parity-helpers.ts";
import type { ParityCaseResult, ParitySuiteOptions } from "./parity-types.ts";

export async function runFixtureCase(
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
    // the durable reference supports them (e.g. RDF-star storage).
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

export async function runReplaceCase(
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
