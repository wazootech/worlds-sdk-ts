import { expect, test } from "bun:test";
import {
  DEFAULT_SEARCH_INDEX_ON_IMPORT,
  planSearchIndexing,
} from "./search-index-policy.ts";

const merge = { importMode: "merge" } as const;
const replace = { importMode: "replace" } as const;
const plan = (project: boolean, reindex: boolean) => ({
  projectDuringCommit: project,
  reindexAfterCommit: reindex,
});

test("planSearchIndexing - incremental projects everywhere and never rebuilds", () => {
  for (const context of [undefined, merge, replace]) {
    expect(planSearchIndexing("incremental", context)).toStrictEqual(plan(true, false));
  }
});

test("planSearchIndexing - disabled does nothing", () => {
  for (const context of [undefined, merge, replace]) {
    expect(planSearchIndexing("disabled", context)).toStrictEqual(plan(false, false));
  }
});

test("planSearchIndexing - deferred defers imports only", () => {
  expect(planSearchIndexing("deferred")).toStrictEqual(plan(true, false));
  expect(planSearchIndexing("deferred", merge)).toStrictEqual(plan(false, true));
  expect(planSearchIndexing("deferred", replace)).toStrictEqual(plan(false, true));
});

test("planSearchIndexing - unset mode uses incremental by default", () => {
  expect(DEFAULT_SEARCH_INDEX_ON_IMPORT).toStrictEqual("incremental");
  expect(planSearchIndexing(undefined, merge)).toStrictEqual(plan(true, false));
});

test("planSearchIndexing - defaultMode overrides the default, not an explicit mode", () => {
  const defaultMode = "deferred" as const;
  expect(planSearchIndexing(undefined, merge, { defaultMode })).toStrictEqual(plan(false, true));
  expect(planSearchIndexing("incremental", merge, { defaultMode })).toStrictEqual(plan(true, false));
  expect(planSearchIndexing("disabled", merge, { defaultMode })).toStrictEqual(plan(false, false));
});
