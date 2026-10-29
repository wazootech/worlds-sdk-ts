import { assertEquals } from "@std/assert";

import { createWazooSdk } from "./create-wazoo-sdk.ts";

// --- createWazooSdk factory test ---

Deno.test("createWazooSdk returns a WorldsSdkInterface", () => {
  const sdk = createWazooSdk({
    baseUrl: "https://data.wazoo.dev",
    token: "test-token",
    worldId: "w_test",
  });

  assertEquals(typeof sdk.import, "function");
  assertEquals(typeof sdk.export, "function");
  assertEquals(typeof sdk.search, "function");
  assertEquals(typeof sdk.sparql, "function");
  assertEquals(typeof sdk.reindex, "function");
});
