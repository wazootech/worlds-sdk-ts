import { assertEquals } from "@std/assert";
import { DataFactory } from "n3";
import { commitPatchToDenokv } from "./commit-patch-to-denokv.ts";
import { readActiveGeneration } from "./kv/denokv-dataset-generation.ts";

const { namedNode, literal, quad } = DataFactory;

const fixtureQuad1 = quad(
  namedNode("http://example.org/s1"),
  namedNode("http://example.org/p1"),
  literal("value1"),
);
const fixtureQuad2 = quad(
  namedNode("http://example.org/s2"),
  namedNode("http://example.org/p2"),
  literal("value2"),
);

Deno.test("commitPatchToDenokv - incremental insert persists readable quad", async () => {
  const kv = await Deno.openKv(":memory:");
  const keyPrefix = ["quads"];

  try {
    await commitPatchToDenokv(
      { insertions: [fixtureQuad1], deletions: [] },
      { kv, keyPrefix },
    );

    const generationId = await readActiveGeneration(kv, keyPrefix);
    let primaryKeyCount = 0;
    for await (
      const _entry of kv.list({ prefix: [...keyPrefix, "g", generationId] })
    ) {
      primaryKeyCount++;
    }
    assertEquals(primaryKeyCount > 0, true);
  } finally {
    kv.close();
  }
});

Deno.test("commitPatchToDenokv - incremental delete removes prior quad keys", async () => {
  const kv = await Deno.openKv(":memory:");
  const keyPrefix = ["quads"];

  try {
    await commitPatchToDenokv(
      { insertions: [fixtureQuad1], deletions: [] },
      { kv, keyPrefix },
    );
    await commitPatchToDenokv(
      { insertions: [], deletions: [fixtureQuad1] },
      { kv, keyPrefix },
    );

    const generationId = await readActiveGeneration(kv, keyPrefix);
    let dataKeyCount = 0;
    for await (
      const _entry of kv.list({ prefix: [...keyPrefix, "g", generationId] })
    ) {
      dataKeyCount++;
    }
    assertEquals(dataKeyCount, 0);
  } finally {
    kv.close();
  }
});

Deno.test(
  "commitPatchToDenokv - importMode replace bumps generation and drops stale keys",
  async () => {
    const kv = await Deno.openKv(":memory:");
    const keyPrefix = ["quads"];

    try {
      await commitPatchToDenokv(
        { insertions: [fixtureQuad1], deletions: [] },
        { kv, keyPrefix },
      );

      const generationBeforeReplace = await readActiveGeneration(kv, keyPrefix);

      await commitPatchToDenokv(
        { insertions: [fixtureQuad2], deletions: [] },
        { kv, keyPrefix },
        { importMode: "replace" },
      );

      const generationAfterReplace = await readActiveGeneration(kv, keyPrefix);
      assertEquals(generationAfterReplace > generationBeforeReplace, true);

      let staleGenerationKeyCount = 0;
      for await (
        const _entry of kv.list({
          prefix: [...keyPrefix, "g", generationBeforeReplace],
        })
      ) {
        staleGenerationKeyCount++;
      }
      assertEquals(staleGenerationKeyCount, 0);
    } finally {
      kv.close();
    }
  },
);

Deno.test("commitPatchToDenokv - empty patch is a no-op", async () => {
  const kv = await Deno.openKv(":memory:");
  const keyPrefix = ["quads"];

  try {
    await commitPatchToDenokv(
      { insertions: [], deletions: [] },
      { kv, keyPrefix },
    );

    assertEquals(await readActiveGeneration(kv, keyPrefix), 0);
  } finally {
    kv.close();
  }
});
