import type { WorldsSdkInterface } from "@/client/client.ts";
import type { ParitySearchCase } from "./parity-fixtures.ts";
import {
  exportQuads,
  exportSerialized,
  importNquads,
  multisetEqual,
  searchResultKey,
  sequenceEqual,
} from "./parity-helpers.ts";
import type { ParitySuiteOptions, WorldsSdkFactory } from "./parity-types.ts";

export async function checkQuadCounts(
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

export async function checkGraphSizes(
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
export async function checkRoundTrip(
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

export async function checkSearchCase(
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
