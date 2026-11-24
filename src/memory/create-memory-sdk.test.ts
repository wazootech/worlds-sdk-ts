import { expect, test } from "bun:test";
import { createMemoryWorldsSdk } from "./create-memory-sdk.ts";

const SEED = [
  '<urn:alice> <urn:likes> "sailing"@en .',
  '<urn:alice> <urn:age> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .',
  '<urn:alice> <urn:posts> "a public note" <urn:graph:public> .',
].join("\n");

test("createMemoryWorldsSdk — import → search → SELECT → ASK → reindex end to end", async () => {
  const sdk = createMemoryWorldsSdk();

  await sdk.import({
    source: {
      kind: "serialized",
      data: SEED,
      contentType: "application/n-quads",
    },
  });

  const search = await sdk.search({ query: "public" });
  expect(search.results?.length).toStrictEqual(1);
  expect(search.results?.[0].text).toStrictEqual("a public note");

  const select = await sdk.sparql({
    query: "SELECT ?o WHERE { <urn:alice> <urn:age> ?o }",
  });
  if (select.kind !== "select") throw new Error("Expected select");
  expect(select.data.results.bindings.length).toStrictEqual(1);
  expect(select.data.results.bindings[0].o?.value).toStrictEqual("42");

  const ask = await sdk.sparql({
    query: "ASK WHERE { GRAPH <urn:graph:public> { ?s ?p ?o } }",
  });
  if (ask.kind !== "ask") throw new Error("Expected ask");
  expect(ask.data.boolean).toStrictEqual(true);

  const reindex = await sdk.reindex();
  expect(reindex.processedQuadCount).toStrictEqual(3);
});

test("createMemoryWorldsSdk — each call returns an independent fresh topology", async () => {
  const first = createMemoryWorldsSdk();
  const second = createMemoryWorldsSdk();

  await first.import({
    source: {
      kind: "serialized",
      data: SEED,
      contentType: "application/n-quads",
    },
  });

  const secondExport = await second.export({ format: { kind: "quads" } });
  if (secondExport.kind !== "quads") throw new Error("Expected quads");
  expect(secondExport.quads.length).toStrictEqual(0);
});
