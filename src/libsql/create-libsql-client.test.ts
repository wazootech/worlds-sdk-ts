import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { createLibsqlClient } from "./create-libsql-client.ts";
import { DataFactory } from "n3";

const queryEngine = new QueryEngine();
const { quad, namedNode, literal } = DataFactory;

Deno.test(
  "createLibsqlClient - queryEngine enables SPARQL on LibsqlRdfjsStore",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    const client = await createLibsqlClient({
      client: databaseClient,
      queryEngine,
    });

    assertExists(client);
    await client.import({
      source: {
        kind: "quads",
        quads: [
          quad(
            namedNode("urn:entity:hex"),
            namedNode("urn:label"),
            literal("persistent client"),
          ),
        ],
      },
    });

    const sparqlResponse = await client.sparql({
      query: "SELECT ?o WHERE { <urn:entity:hex> <urn:label> ?o }",
    });

    assertEquals(sparqlResponse.kind, "select");

    databaseClient.close();
  },
);
