import { assertEquals } from "@std/assert";
import { sanitizeFtsQuery } from "./libsql-search-query-builder.ts";

Deno.test("sanitizeFtsQuery - strips common stopwords while preserving content words", () => {
  assertEquals(
    sanitizeFtsQuery("What is the capital of Aurelia?"),
    `"capital" "aurelia"`,
  );
});

Deno.test("sanitizeFtsQuery - preserves original tokens when the query is stopword-only", () => {
  assertEquals(
    sanitizeFtsQuery("what is the"),
    `"what" "is" "the"`,
  );
});
