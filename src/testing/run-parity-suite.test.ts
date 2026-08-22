import { assertEquals, assertFalse } from "@std/assert";
import { DataFactory } from "n3";
import type * as rdfjs from "@rdfjs/types";
import { createMemoryWorldsSdk } from "@/memory/mod.ts";
import { multiGraphWorld, parityCorpus } from "./parity-fixtures.ts";
import { runParitySuite, type WorldsSdkFactory } from "./run-parity-suite.ts";

const { quad, namedNode, literal } = DataFactory;

/**
 * The harness proves itself against the engine's MemoryStore via
 * createMemoryWorldsSdk (@worlds/sdk/memory) — the family's portable in-memory
 * reference (wazootech/workspace#74). The n3.Store topology lives in
 * run-parity-suite.n3.test.ts as a cross-store differential check.
 */
const memoryFactory: WorldsSdkFactory = () => createMemoryWorldsSdk();

Deno.test("runParitySuite - passes the full corpus on identical in-memory Sdks", async () => {
  const report = await runParitySuite({
    reference: memoryFactory,
    candidate: memoryFactory,
  });

  assertEquals(
    report.results.length,
    parityCorpus.fixtures.length + parityCorpus.replaceCases.length,
    "every corpus fixture and replace case runs",
  );
  assertEquals(
    report.ok,
    true,
    report.results
      .map(
        (r) =>
          `${r.name}: ${r.failures.join("; ")}` +
          `${r.notes ? ` [notes: ${r.notes.join("; ")}]` : ""}`,
      )
      .join("\n"),
  );

  // The declared-gate RDF-star fixture must run clean through the in-memory
  // path (the SPARQL engine models quoted triples) and be reported, not skipped.
  const rdfStar = report.results.find((r) => r.name === "rdfStarWorld");
  assertEquals(rdfStar?.ok, true);
  assertEquals(rdfStar?.notes, undefined, JSON.stringify(rdfStar?.notes));
});

Deno.test("runParitySuite - fails when the candidate reorders search results", async () => {
  const brokenCandidate: WorldsSdkFactory = () => {
    const sdk = createMemoryWorldsSdk();
    const originalSearch = sdk.search.bind(sdk);
    // Deliberately invert top-K ordering to violate the parity contract.
    sdk.search = async (request) => {
      const response = await originalSearch(request);
      return { results: [...(response.results ?? [])].reverse() };
    };
    return sdk;
  };

  const report = await runParitySuite({
    reference: memoryFactory,
    candidate: brokenCandidate,
    fixtures: [multiGraphWorld],
    replaceCases: [],
  });

  assertFalse(report.ok);
  const searchFailures = report.results.flatMap((r) => r.failures);
  assertEquals(
    searchFailures.some((failure) => failure.includes("search case")),
    true,
    searchFailures.join("\n"),
  );
});

Deno.test("runParitySuite - fails when the candidate's quad counts differ", async () => {
  const extraQuad: rdfjs.Quad = quad(
    namedNode("urn:stray"),
    namedNode("urn:p"),
    literal("stray"),
  );
  const bloatedCandidate: WorldsSdkFactory = () => {
    const sdk = createMemoryWorldsSdk();
    const originalImport = sdk.import.bind(sdk);
    // Deliberately add a stray quad after every import to break the count contract.
    sdk.import = async (request) => {
      await originalImport(request);
      await originalImport({
        mode: "merge",
        source: { kind: "quads", quads: [extraQuad] },
      });
    };
    return sdk;
  };

  const report = await runParitySuite({
    reference: memoryFactory,
    candidate: bloatedCandidate,
    fixtures: [multiGraphWorld],
    replaceCases: [],
  });

  assertFalse(report.ok);
  const countFailures = report.results.flatMap((r) => r.failures);
  assertEquals(
    countFailures.some((failure) => failure.includes("quad count")),
    true,
    countFailures.join("\n"),
  );
});

Deno.test("runParitySuite - reports declared-gate notes without failing the suite", async () => {
  const throwingReference: WorldsSdkFactory = () => {
    const sdk = createMemoryWorldsSdk();
    const originalImport = sdk.import.bind(sdk);
    // Simulate a durable reference that cannot store RDF-star (throws on import).
    sdk.import = async (request) => {
      if (
        request.source.kind === "serialized" &&
        request.source.data.includes("<<")
      ) {
        throw new Error("Unsupported term type: Quad");
      }
      await originalImport(request);
    };
    return sdk;
  };

  const report = await runParitySuite({
    reference: throwingReference,
    candidate: memoryFactory,
    fixtures: [parityCorpus.fixtures.find((f) => f.name === "rdfStarWorld")!],
    replaceCases: [],
  });

  assertEquals(report.ok, true, "declared-gate cases never fail the suite");
  const rdfStar = report.results[0];
  assertEquals(rdfStar?.ok, true);
  assertEquals(
    rdfStar?.notes?.some((note) => note.includes("Unsupported term type")),
    true,
    JSON.stringify(rdfStar?.notes),
  );
});
