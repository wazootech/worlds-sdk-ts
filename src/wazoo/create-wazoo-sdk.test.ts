import { expect, test } from "bun:test";

import { createWazooSdk } from "./create-wazoo-sdk.ts";

// --- createWazooSdk factory test ---

test("createWazooSdk returns a WorldsSdkInterface", () => {
  const sdk = createWazooSdk({
    baseUrl: "https://data.wazoo.dev",
    token: "test-token",
    worldId: "w_test",
  });

  expect(typeof sdk.import).toStrictEqual("function");
  expect(typeof sdk.export).toStrictEqual("function");
  expect(typeof sdk.search).toStrictEqual("function");
  expect(typeof sdk.sparql).toStrictEqual("function");
  expect(typeof sdk.reindex).toStrictEqual("function");
});
