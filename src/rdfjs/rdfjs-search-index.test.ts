import { assertEquals } from "@std/assert";
import { DataFactory, Store } from "n3";
import { RdfjsSearchIndex } from "./rdfjs-search-index.ts";

Deno.test("RdfjsSearchIndex.search - returns literal matching text locally", async () => {
  const store = new Store();
  store.addQuad(
    DataFactory.namedNode("http://example.com/entity1"),
    DataFactory.namedNode("http://example.com/hasDesc"),
    DataFactory.literal("Found some delicious tacos for lunch"),
  );
  store.addQuad(
    DataFactory.namedNode("http://example.com/entity2"),
    DataFactory.namedNode("http://example.com/hasDesc"),
    DataFactory.literal("Boring non-matching payload"),
  );

  const searchIndex = new RdfjsSearchIndex(store);
  const response = await searchIndex.search({
    query: "Tacos",
  });

  assertEquals(response.results?.length, 1);
  assertEquals(
    response.results?.[0].text,
    "Found some delicious tacos for lunch",
  );
});

Deno.test("RdfjsSearchIndex.search - inclusion filters strictly limit results to allowed subjects", async () => {
  const store = new Store();
  const targetSubject = "http://example.com/target";
  store.addQuad(
    DataFactory.namedNode(targetSubject),
    DataFactory.namedNode("http://example.com/desc"),
    DataFactory.literal("Match me!"),
  );
  store.addQuad(
    DataFactory.namedNode("http://example.com/wrong"),
    DataFactory.namedNode("http://example.com/desc"),
    DataFactory.literal("Match me!"),
  );

  const searchIndex = new RdfjsSearchIndex(store);
  const response = await searchIndex.search({
    query: "match",
    include: { subjects: [targetSubject] },
  });

  assertEquals(response.results?.length, 1);
  assertEquals(response.results?.[0].subject, targetSubject);
});

Deno.test("RdfjsSearchIndex.search - exclusion filters correctly strip matching predicates", async () => {
  const store = new Store();
  const excludePred = "http://example.com/hidden";
  store.addQuad(
    DataFactory.namedNode("http://example.com/subject"),
    DataFactory.namedNode(excludePred),
    DataFactory.literal("Secret text query"),
  );

  const searchIndex = new RdfjsSearchIndex(store);
  const response = await searchIndex.search({
    query: "secret",
    exclude: { predicates: [excludePred] },
  });

  assertEquals(
    response.results?.length,
    0,
    "Excluded predicate hit should have been filtered out",
  );
});

Deno.test("RdfjsSearchIndex.search - ignores structured primitives to suppress search space noise", async () => {
  const store = new Store();

  // 1. Insert a valid Searchable Literal (String)
  store.addQuad(
    DataFactory.namedNode("http://example.com/s1"),
    DataFactory.namedNode("http://example.com/p1"),
    DataFactory.literal("The magic number is 42"),
  );

  // 2. Insert a non-searchable structured primitive (Integer)
  store.addQuad(
    DataFactory.namedNode("http://example.com/s2"),
    DataFactory.namedNode("http://example.com/p1"),
    DataFactory.literal(
      "42",
      DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
    ),
  );

  const searchIndex = new RdfjsSearchIndex(store);

  // Search for "42". This matches BOTH raw values string-wise.
  const response = await searchIndex.search({ query: "42" });

  // RED EXPECTATION: Should ignore the integer, returning ONLY the textual sentence.
  assertEquals(
    response.results?.length,
    1,
    "Expected raw integer literal to be completely ignored in search index matching",
  );
  assertEquals(
    response.results?.[0].text,
    "The magic number is 42",
  );
});
