import { expect, test } from "bun:test";
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

test("conformance suite - the reference pipeline passes every case", async () => {
  const report = await run();
  expect(report.results.length).toStrictEqual(10);
  expect(report.notes).toStrictEqual(undefined);
  expect(report.ok ? "ok" : describe(report)).toBe("ok");
});

test("conformance suite - a backend defaulting to deferred passes when it says so", async () => {
  const report = await run({ defaultMode: "deferred" }, {
    defaultSearchIndexOnImport: "deferred",
  });
  expect(report.ok ? "ok" : describe(report)).toBe("ok");
});

test("conformance suite - a declared default that does not match fails the default-mode case", async () => {
  const report = await run({ defaultMode: "deferred" });
  expect(failedCases(report)).toStrictEqual(["default mode matches the contract"]);
});

test("conformance suite - catches a store that writes quads before embedding", async () => {
  const report = await run({ bug: "write-before-embed" });
  expect(report.ok).toStrictEqual(false);
  expect(failedCases(report).includes("embedding failure follows the contract")).toStrictEqual(true);
});

test("conformance suite - catches orphan chunk rows left by a failed write, atomic or not", async () => {
  const bug = { bug: "orphan-chunks-on-failure" } as const;
  for (const declared of [{}, { atomic: false }]) {
    const report = await run(bug, declared);
    expect(report.ok).toStrictEqual(false);
    expect(failedCases(report).includes("write failure leaves no orphan chunks")).toStrictEqual(true);
  }
});

test("conformance suite - a failed replace import that wiped the graph passes only when declared", async () => {
  const wiping = { bug: "wipe-before-failure" } as const;
  expect(failedCases(await run(wiping))).toStrictEqual([
    "replace-import failure follows the contract",
  ]);
  const declared = await run(wiping, { replaceImportFailure: "empties-graph" });
  expect(declared.ok ? "ok" : describe(declared)).toBe("ok");
});

test("conformance suite - a subject without failLaterWrite keeps its nine cases and gets a note", async () => {
  const report = await runCommitConformanceSuite({
    contract,
    create: (create) => {
      const { failLaterWrite: _, ...legacy } = createReferenceCommitStore(
        create,
      );
      return legacy;
    },
  });
  expect(report.ok ? "ok" : describe(report)).toBe("ok");
  expect(report.results.length).toStrictEqual(9);
  expect(report.notes?.length).toStrictEqual(1);
  expect(report.notes?.[0]?.startsWith("later-write failure follows the contract: ")).toStrictEqual(true);
});

test("conformance suite - a later-write failure that leaves quads behind passes only when declared", async () => {
  const keeping = { bug: "keep-quads-on-later-failure" } as const;
  const later = "later-write failure follows the contract";
  for (const declared of [{}, { atomic: false }]) {
    expect(failedCases(await run(keeping, declared))).toStrictEqual([later]);
  }
  const limits = {
    atomic: false,
    laterWriteFailure: "keeps-written-quads",
  } as const;
  expect((await run(keeping, limits)).ok).toStrictEqual(true);
  // A non-atomic backend that cleans up passes with the default declaration.
  expect((await run({}, { atomic: false })).ok).toStrictEqual(true);
});

test("conformance suite - catches orphan chunk rows left by a failed later write", async () => {
  const bug = { bug: "orphan-chunks-on-failure" } as const;
  const keeps = {
    atomic: false,
    laterWriteFailure: "keeps-written-quads",
  } as const;
  for (const declared of [{}, keeps]) {
    expect(failedCases(await run(bug, declared)).includes(
        "later-write failure follows the contract",
      )).toStrictEqual(true);
  }
});
