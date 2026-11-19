import { assertEquals } from "@std/assert";
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

Deno.test("planSearchIndexing - incremental projects everywhere and never rebuilds", () => {
  for (const context of [undefined, merge, replace]) {
    assertEquals(planSearchIndexing("incremental", context), plan(true, false));
  }
});

Deno.test("planSearchIndexing - disabled does nothing", () => {
  for (const context of [undefined, merge, replace]) {
    assertEquals(planSearchIndexing("disabled", context), plan(false, false));
  }
});

Deno.test("planSearchIndexing - deferred defers imports only", () => {
  assertEquals(planSearchIndexing("deferred"), plan(true, false));
  assertEquals(planSearchIndexing("deferred", merge), plan(false, true));
  assertEquals(planSearchIndexing("deferred", replace), plan(false, true));
});

Deno.test("planSearchIndexing - unset mode uses incremental by default", () => {
  assertEquals(DEFAULT_SEARCH_INDEX_ON_IMPORT, "incremental");
  assertEquals(planSearchIndexing(undefined, merge), plan(true, false));
});

Deno.test("planSearchIndexing - defaultMode overrides the default, not an explicit mode", () => {
  const defaultMode = "deferred" as const;
  assertEquals(
    planSearchIndexing(undefined, merge, { defaultMode }),
    plan(false, true),
  );
  assertEquals(
    planSearchIndexing("incremental", merge, { defaultMode }),
    plan(true, false),
  );
  assertEquals(
    planSearchIndexing("disabled", merge, { defaultMode }),
    plan(false, false),
  );
});
