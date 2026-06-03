import { Client } from "@worlds/client";
import { ComunicaSparqlEngine } from "@worlds/client/comunica";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/client/rdfjs";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";

if (import.meta.main) {
  const store = new Store();
  const queryEngine = new QueryEngine();
  const client = new Client({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
    sparqlEngine: new ComunicaSparqlEngine({ queryEngine, store: store }),
  });

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
