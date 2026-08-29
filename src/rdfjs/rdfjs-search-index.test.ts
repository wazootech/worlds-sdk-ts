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

Deno.test("RdfjsSearchIndex.search - graph-scoped include limits results to the named graph", async () => {
  const store = new Store();
  // Default graph: alice writes a public note
  store.addQuad(
    DataFactory.namedNode("urn:alice"),
    DataFactory.namedNode("urn:posted"),
    DataFactory.literal("alice wrote a public note"),
    DataFactory.namedNode("urn:graph:public"),
  );
  // Default graph: bob writes a public note
  store.addQuad(
    DataFactory.namedNode("urn:bob"),
    DataFactory.namedNode("urn:posted"),
    DataFactory.literal("bob is public too"),
    DataFactory.namedNode("urn:graph:public"),
  );
  // Private graph: alice stores confidential material
  store.addQuad(
    DataFactory.namedNode("urn:alice"),
    DataFactory.namedNode("urn:stores"),
    DataFactory.literal("confidential key material for alice"),
    DataFactory.namedNode("urn:graph:private"),
  );

  const searchIndex = new RdfjsSearchIndex(store);

  // Scoping to public graph should return only public-graph results
  const publicResults = await searchIndex.search({
    query: "alice",
    include: { graphs: ["urn:graph:public"] },
  });
  const publicHits = publicResults.results ?? [];
  assertEquals(publicHits.length, 1);
  assertEquals(publicHits[0].graph, "urn:graph:public");
  assertEquals(publicHits[0].text, "alice wrote a public note");

  // Scoping to private graph should return only private-graph results
  const privateResults = await searchIndex.search({
    query: "confidential",
    include: { graphs: ["urn:graph:private"] },
  });
  const privateHits = privateResults.results ?? [];
  assertEquals(privateHits.length, 1);
  assertEquals(privateHits[0].graph, "urn:graph:private");
});

Deno.test("RdfjsSearchIndex.search - graph-scoped exclude strips results from the named graph", async () => {
  const store = new Store();
  store.addQuad(
    DataFactory.namedNode("urn:alice"),
    DataFactory.namedNode("urn:posted"),
    DataFactory.literal("public note"),
    DataFactory.namedNode("urn:graph:public"),
  );
  store.addQuad(
    DataFactory.namedNode("urn:alice"),
    DataFactory.namedNode("urn:stores"),
    DataFactory.literal("private note"),
    DataFactory.namedNode("urn:graph:private"),
  );

  const searchIndex = new RdfjsSearchIndex(store);

  // Excluding the private graph should hide private-graph results
  const response = await searchIndex.search({
    query: "note",
    exclude: { graphs: ["urn:graph:private"] },
  });
  const hits = response.results ?? [];
  assertEquals(hits.length, 1);
  assertEquals(hits[0].graph, "urn:graph:public");
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
