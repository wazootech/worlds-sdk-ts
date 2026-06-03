import { assertEquals } from "@std/assert";
import {
  buildChunkFtsValue,
  extractRdfLocalLabel,
  formatPredicatePhrase,
} from "./search-chunk-fts.ts";

Deno.test("buildChunkFtsValue - includes subject local name predicate and literal", () => {
  const ftsValue = buildChunkFtsValue({
    quad_id: "q1",
    subject: "http://example.org/Aurelia",
    predicate: "http://example.org/hasCapital",
    graph: "",
    value: "Lume",
  }, { labelLiteralsForSubject: [] });

  assertEquals(ftsValue, "Aurelia has capital Lume");
});

Deno.test("buildChunkFtsValue - appends configured label literals for subject", () => {
  const ftsValue = buildChunkFtsValue({
    quad_id: "q1",
    subject: "http://example.org/Aurelia",
    predicate: "http://example.org/hasCapital",
    graph: "",
    value: "Lume",
  }, { labelLiteralsForSubject: ["Kingdom of Aurelia"] });

  assertEquals(ftsValue, "Aurelia has capital Lume Kingdom of Aurelia");
});

Deno.test("extractRdfLocalLabel - humanizes underscore and camelCase IRIs", () => {
  assertEquals(
    extractRdfLocalLabel("http://example.org/has_capital_city"),
    "has capital city",
  );
  assertEquals(
    extractRdfLocalLabel("http://example.org/hasCapitalCity"),
    "has Capital City",
  );
});

Deno.test("formatPredicatePhrase - lowercases predicate local name", () => {
  assertEquals(
    formatPredicatePhrase("http://example.org/hasCapital"),
    "has capital",
  );
});
