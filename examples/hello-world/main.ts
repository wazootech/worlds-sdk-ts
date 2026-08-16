import { Client } from "@worlds/sdk";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";
import { Store } from "n3";

if (import.meta.main) {
  const store = new Store();
  const client = new Client({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
    sparqlEngine: new WazooSparqlEngine({ store }),
  });

  await client.import({
    source: {
      kind: "serialized",
      data:
        `<http://example.com/subject> <http://example.com/predicate> "Hello, World!" .`,
      contentType: "text/turtle",
    },
  });

  const searchResponse = await client.search({ query: "Hello" });
  console.log(JSON.stringify(searchResponse, null, 2));

  const sparqlResponse = await client.sparql({
    query: `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  });
  console.log(JSON.stringify(sparqlResponse, null, 2));
}
