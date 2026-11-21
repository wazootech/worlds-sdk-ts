import { assertEquals } from "@std/assert";
import { runCommitConformanceSuite } from "./run-commit-conformance.ts";
import {
  createReferenceCommitStore,
  type ReferenceStoreOptions,
} from "./reference-commit-store.ts";
import type { CommitConformanceContract } from "./commit-conformance-types.ts";
import type { ParityReport } from "./parity-types.ts";

const contract: CommitConformanceContract = {
  atomic: true,
  embeddingFailure: "throws",
  replaceImportFailure: "keeps-old-graph",
  defaultSearchIndexOnImport: "incremental",
};

const run = (
  overrides: Partial<ReferenceStoreOptions> = {},
  declared: Partial<CommitConformanceContract> = {},
): Promise<ParityReport> =>
  runCommitConformanceSuite({
    contract: { ...contract, ...declared },
    create: (create) => createReferenceCommitStore({ ...create, ...overrides }),
  });

const describe = (report: ParityReport) =>
  report.results.flatMap((r) => r.failures.map((f) => `${r.name}: ${f}`)).join(
    "\n",
  );

const failedCases = (report: ParityReport) =>
  report.results.filter((r) => !r.ok).map((r) => r.name);

Deno.test("conformance suite - the reference pipeline passes every case", async () => {
  const report = await run();
  assertEquals(report.results.length, 10);
  assertEquals(report.notes, undefined);
  assertEquals(report.ok, true, describe(report));
});

Deno.test("conformance suite - a backend defaulting to deferred passes when it says so", async () => {
  const report = await run({ defaultMode: "deferred" }, {
    defaultSearchIndexOnImport: "deferred",
  });
  assertEquals(report.ok, true, describe(report));
});

Deno.test("conformance suite - a declared default that does not match fails the default-mode case", async () => {
  const report = await run({ defaultMode: "deferred" });
  assertEquals(failedCases(report), ["default mode matches the contract"]);
});

Deno.test("conformance suite - catches a store that writes quads before embedding", async () => {
  const report = await run({ bug: "write-before-embed" });
  assertEquals(report.ok, false);
  assertEquals(
    failedCases(report).includes("embedding failure follows the contract"),
    true,
  );
});

Deno.test("conformance suite - catches orphan chunk rows left by a failed write, atomic or not", async () => {
  const bug = { bug: "orphan-chunks-on-failure" } as const;
  for (const declared of [{}, { atomic: false }]) {
    const report = await run(bug, declared);
    assertEquals(report.ok, false);
    assertEquals(
      failedCases(report).includes("write failure leaves no orphan chunks"),
      true,
    );
  }
});

Deno.test("conformance suite - a failed replace import that wiped the graph passes only when declared", async () => {
  const wiping = { bug: "wipe-before-failure" } as const;
  assertEquals(failedCases(await run(wiping)), [
    "replace-import failure follows the contract",
  ]);
  const declared = await run(wiping, { replaceImportFailure: "empties-graph" });
  assertEquals(declared.ok, true, describe(declared));
});

Deno.test("conformance suite - a subject without failLaterWrite keeps its nine cases and gets a note", async () => {
  const report = await runCommitConformanceSuite({
    contract,
    create: (create) => {
      const { failLaterWrite: _, ...legacy } = createReferenceCommitStore(
        create,
      );
      return legacy;
    },
  });
  assertEquals(report.ok, true, describe(report));
  assertEquals(report.results.length, 9);
  assertEquals(report.notes?.length, 1);
  assertEquals(
    report.notes?.[0]?.startsWith("later-write failure follows the contract: "),
    true,
  );
});

Deno.test("conformance suite - a later-write failure that leaves quads behind passes only when declared", async () => {
  const keeping = { bug: "keep-quads-on-later-failure" } as const;
  const later = "later-write failure follows the contract";
  for (const declared of [{}, { atomic: false }]) {
    assertEquals(failedCases(await run(keeping, declared)), [later]);
  }
  const limits = {
    atomic: false,
    laterWriteFailure: "keeps-written-quads",
  } as const;
  assertEquals((await run(keeping, limits)).ok, true);
  // A non-atomic backend that cleans up passes with the default declaration.
  assertEquals((await run({}, { atomic: false })).ok, true);
});

Deno.test("conformance suite - catches orphan chunk rows left by a failed later write", async () => {
  const bug = { bug: "orphan-chunks-on-failure" } as const;
  const keeps = {
    atomic: false,
    laterWriteFailure: "keeps-written-quads",
  } as const;
  for (const declared of [{}, keeps]) {
    assertEquals(
      failedCases(await run(bug, declared)).includes(
        "later-write failure follows the contract",
      ),
      true,
    );
  }
});
