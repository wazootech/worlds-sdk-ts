import { Client } from "@worlds/sdk";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@worlds/sdk/rdfjs";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { Store } from "n3";
import { GRAPH_GROUNDED_AGENT_SYSTEM_PROMPT } from "./agent-prompts.ts";
import { createTools } from "./tools.ts";
import { generateText, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

if (import.meta.main) {
  const google = createGoogleGenerativeAI();

  console.log("Initializing embedded in-memory knowledge base...");
  const store = new Store();

  const client = new Client({
    quadStore: new RdfjsQuadStore({ store }),
    searchIndex: new RdfjsSearchIndex(store),
    sparqlEngine: new WazooSparqlEngine({ store: store }),
  });

  console.log("Ingesting initial knowledge...");
  await client.import({
    source: {
      kind: "serialized",
      data: `
        @prefix ex: <http://example.com/> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        ex:HarryPotter rdfs:label "Harry Potter" ;
                       ex:author "J.K. Rowling" ;
                       ex:protagonist ex:Harry .
        ex:Harry rdfs:label "Harry" ;
                 ex:house "Gryffindor" .
      `,
      contentType: "text/turtle",
    },
  });

  console.log("Generating AI tools...");
  const tools = createTools(client, {
    sparql: { allowUpdates: false },
  });

  console.log("Querying the AI...");

  const output = await generateText({
    model: google("gemini-2.5-flash"),
    system: GRAPH_GROUNDED_AGENT_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(5),
    prompt:
      'Find the house of the protagonist linked to the work with label "Harry Potter". First call searchWorld with exactly "Harry Potter". Then use one executeSparql SELECT that binds the work URI from search and traverses to the protagonist and house. Answer with only the exact house literal from SPARQL bindings.',
  });

  console.log("\nTool Call History:");
  for (const step of output.steps) {
    if (step.toolCalls.length > 0) {
      console.log(JSON.stringify(step.toolCalls, null, 2));
    }
  }
}
