import { type Client, sparqlWorld } from "@worlds/client";
import type {
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
} from "@/client/sparql-engine/mod.ts";
import { parseSparqlResponse } from "./parse-sparql-response.ts";

/**
 * RemoteSparqlEngine implements SparqlEngineInterface by delegating to the
 * Worlds data-plane API via @worlds/client.
 *
 * Limitations vs local engines:
 * - `baseIri`, `timeoutMs`, and `signal` are ignored. The API determines
 *   timeout and does not support abort signals.
 */
export class RemoteSparqlEngine implements SparqlEngineInterface {
  constructor(
    private readonly client: Client,
    private readonly worldId: string,
  ) {}

  async execute(request: SparqlRequest): Promise<SparqlResponse> {
    const result = await sparqlWorld({
      client: this.client,
      path: { id: this.worldId },
      body: { query: request.query },
    });

    if (result.error) {
      throw new Error(
        `SPARQL failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }

    return parseSparqlResponse(result.data);
  }
}
