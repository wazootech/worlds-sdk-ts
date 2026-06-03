import { createDenokvClient } from "@worlds/client/denokv";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";

if (import.meta.main) {
  using kv = await Deno.openKv(":memory:");
  const queryEngine = new QueryEngine();
  const client = createDenokvClient({ kv, queryEngine });

  await client.import({
    source: {
      kind: "serialized",
      data:
        `<http://example.com/subject> <http://example.com/predicate> "Hello, World!" .`,
      contentType: "text/turtle",
    },
    mode: "merge",
  });

  const searchResponse = await client.search({ query: "Hello" });
  console.log(JSON.stringify(searchResponse, null, 2));

  const sparqlResponse = await client.sparql({
    query: `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  });
  console.log(JSON.stringify(sparqlResponse, null, 2));
}
