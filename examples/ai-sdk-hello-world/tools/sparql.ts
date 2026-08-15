import { tool } from "ai";
import type { ClientInterface } from "@worlds/client";
import type { SparqlRequest } from "@worlds/client/sparql-engine";
import { z } from "zod";
import { EXECUTE_SPARQL_TOOL_DESCRIPTION } from "./agent-tool-descriptions.ts";

/**
 * ExecuteSparqlOptions defines the configuration options for the executeSparql tool.
 */
export interface ExecuteSparqlOptions {
  /**
   * allowUpdates controls whether the tool permits SPARQL UPDATE operations (e.g., INSERT, DELETE).
   * @default true
   */
  allowUpdates?: boolean;
}

/**
 * createExecuteSparqlTool creates an AI SDK tool for executing SPARQL queries against the knowledge base.
 *
 * @param client The Worlds Client instance.
 * @param options Configuration options for the tool.
 * @returns An AI SDK tool for executing SPARQL queries against the knowledge base.
 */
export function createExecuteSparqlTool(
  client: ClientInterface,
  options?: ExecuteSparqlOptions,
) {
  return tool({
    description: EXECUTE_SPARQL_TOOL_DESCRIPTION,
    inputSchema: z.object({
      query: z.string().describe(
        "The raw read-only SPARQL query string. Only SELECT and ASK are allowed when updates are disabled.",
      ),
      baseIri: z.string().optional().describe(
        "Base IRI for the query execution.",
      ),
      timeoutMs: z.number().optional().describe(
        "Query timeout in milliseconds (defaults to 30 seconds).",
      ),
    }),
    execute: async (request: SparqlRequest) => {
      if (options?.allowUpdates === false) {
        if (/\b(INSERT|DELETE|DROP|CLEAR|LOAD|CREATE)\b/i.test(request.query)) {
          return {
            success: false,
            error:
              "SPARQL updates are disabled for this agent. Please only execute SELECT or ASK queries.",
          };
        }
      }

      try {
        const response = await client.sparql(request);
        return {
          success: true,
          data: response.kind === "void" ? null : response.data,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
