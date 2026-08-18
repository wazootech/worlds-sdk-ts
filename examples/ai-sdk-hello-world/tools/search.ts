import { tool } from "ai";
import type { SdkInterface } from "@worlds/sdk";
import type { SearchRequest, SearchResponse } from "@worlds/sdk/search-index";
import { z } from "zod";
import { SEARCH_WORLD_TOOL_DESCRIPTION } from "./agent-tool-descriptions.ts";

/**
 * createSearchWorldTool creates an AI SDK tool for searching the knowledge base.
 *
 * @param client The Worlds Client instance.
 * @returns An AI SDK tool for searching the knowledge base.
 */
export function createSearchWorldTool(client: SdkInterface) {
  return tool({
    description: SEARCH_WORLD_TOOL_DESCRIPTION,
    inputSchema: z.object({
      query: z.string().describe(
        "Exact label, keyword, or natural-language phrase to search for.",
      ),
      include: z.object({
        subjects: z.array(z.string()).optional().describe(
          "Restricts matching to specific subject IRIs.",
        ),
        predicates: z.array(z.string()).optional().describe(
          "Restricts matching to specific predicate IRIs.",
        ),
        graphs: z.array(z.string()).optional().describe(
          "Restricts matching to specific Named Graphs.",
        ),
      }).optional().describe(
        "Positive boundary conditions. Facts MUST satisfy all declared constraints.",
      ),
      exclude: z.object({
        subjects: z.array(z.string()).optional().describe(
          "Rejects specific subject IRIs.",
        ),
        predicates: z.array(z.string()).optional().describe(
          "Rejects specific predicate IRIs.",
        ),
        graphs: z.array(z.string()).optional().describe(
          "Rejects specific Named Graphs.",
        ),
      }).optional().describe(
        "Negative boundary conditions. Facts matching ANY constraint are rejected.",
      ),
    }),
    execute: async (
      request: SearchRequest,
    ): Promise<
      | ({ success: true } & SearchResponse)
      | { success: false; error: string }
    > => {
      try {
        const response = await client.search(request);
        return {
          success: true,
          ...response,
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
