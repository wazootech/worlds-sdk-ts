import { assertEquals } from "@std/assert";
import { createMemorySdk } from "./create-memory-sdk.ts";

const SEED = [
  '<urn:alice> <urn:likes> "sailing"@en .',
  '<urn:alice> <urn:age> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .',
  '<urn:alice> <urn:posts> "a public note" <urn:graph:public> .',
].join("\n");

Deno.test("createMemorySdk — import → search → SELECT → ASK → reindex end to end", async () => {
  const sdk = createMemorySdk();

  await sdk.import({
    source: {
      kind: "serialized",
      data: SEED,
      contentType: "application/n-quads",
    },
  });

  const search = await sdk.search({ query: "public" });
  assertEquals(search.results?.length, 1);
  assertEquals(search.results?.[0].text, "a public note");

  const select = await sdk.sparql({
    query: "SELECT ?o WHERE { <urn:alice> <urn:age> ?o }",
  });
  if (select.kind !== "select") throw new Error("Expected select");
  assertEquals(select.data.results.bindings.length, 1);
  assertEquals(
    select.data.results.bindings[0].o?.value,
    "42",
  );

  const ask = await sdk.sparql({
    query: "ASK WHERE { GRAPH <urn:graph:public> { ?s ?p ?o } }",
  });
  if (ask.kind !== "ask") throw new Error("Expected ask");
  assertEquals(ask.data.boolean, true);

  const reindex = await sdk.reindex();
  assertEquals(reindex.processedQuadCount, 3);
});

Deno.test("createMemorySdk — each call returns an independent fresh topology", async () => {
  const first = createMemorySdk();
  const second = createMemorySdk();

  await first.import({
    source: {
      kind: "serialized",
      data: SEED,
      contentType: "application/n-quads",
    },
  });

  const secondExport = await second.export({ format: { kind: "quads" } });
  if (secondExport.kind !== "quads") throw new Error("Expected quads");
  assertEquals(secondExport.quads.length, 0, "second Sdk must start empty");
});
