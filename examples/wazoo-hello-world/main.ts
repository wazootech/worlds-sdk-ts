import { createWazooSdk } from "@worlds/sdk/wazoo";

/**
 * Wazoo Hello World — connects to a hosted Worlds API via createWazooSdk.
 *
 * Environment variables:
 *   WORLDS_BASE_URL  — Worlds data-plane API root (default: https://data.wazoo.dev)
 *   WORLDS_TOKEN     — Bearer token for authentication (required)
 *   WORLDS_WORLD_ID  — Canonical world identifier, e.g. w_<ULID> (required)
 *
 * Usage:
 *   WORLDS_TOKEN=xxx WORLDS_WORLD_ID=w_xxx bun run example:wazoo-hello-world
 */
if (import.meta.main) {
  const baseUrl = process.env.WORLDS_BASE_URL ??
    "https://data.wazoo.dev";
  const token = process.env.WORLDS_TOKEN;
  const worldId = process.env.WORLDS_WORLD_ID;

  if (!token || !worldId) {
    console.error(
      "Missing required env vars: WORLDS_TOKEN and WORLDS_WORLD_ID",
    );
    console.error(
      "Usage: WORLDS_TOKEN=xxx WORLDS_WORLD_ID=w_xxx bun run example:wazoo-hello-world",
    );
    process.exit(1);
  }

  // Create a remote WorldsSdk — same interface as every other backend
  const sdk = createWazooSdk({ baseUrl, token, worldId });

  // Import a triple
  console.log("Importing triple...");
  await sdk.import({
    source: {
      kind: "serialized",
      data:
        `<http://example.com/subject> <http://example.com/predicate> "Hello, Wazoo!" .`,
      contentType: "text/turtle",
    },
  });
  console.log("Import complete.");

  // Search for it
  console.log("\nSearching for 'Hello'...");
  const searchResponse = await sdk.search({ query: "Hello" });
  console.log(JSON.stringify(searchResponse, null, 2));

  // SPARQL query
  console.log("\nRunning SPARQL query...");
  const sparqlResponse = await sdk.sparql({
    query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
  });
  console.log(JSON.stringify(sparqlResponse, null, 2));
}
