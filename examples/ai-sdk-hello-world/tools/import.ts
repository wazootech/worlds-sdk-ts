import { tool } from "ai";
import type { SdkInterface } from "@worlds/sdk";
import type { ImportRequest } from "@worlds/sdk/quad-store";
import { z } from "zod";

/**
 * SerializedImportRequest is a discriminated ImportRequest type that only allows "serialized" sources.
 */
export type SerializedImportRequest = Omit<ImportRequest, "source"> & {
  source: Extract<ImportRequest["source"], { kind: "serialized" }>;
};

/**
 * createImportRdfTool creates an AI SDK tool for importing data into the knowledge base.
 *
 * @param client The Worlds SDK instance.
 * @returns An AI SDK tool for importing data into the knowledge base.
 */
export function createImportRdfTool(client: SdkInterface) {
  return tool({
    description:
      "Import serialized RDF data (like Turtle or N-Triples) into the knowledge base. Useful for storing new factual statements or relations.",
    inputSchema: z.object({
      mode: z.enum(["merge", "replace"]).optional().describe(
        "Mode of import (defaults to 'merge').",
      ),
      source: z.object({
        kind: z.literal("serialized").describe(
          "The kind of data source. Always use 'serialized'.",
        ),
        data: z.string().describe("The serialized RDF data to import."),
        contentType: z.string().optional().describe(
          "The MIME type of the data. Usually 'text/turtle' or 'application/n-triples'.",
        ),
      }),
    }),
    execute: async (request: SerializedImportRequest) => {
      try {
        if (
          request.source.kind === "serialized" && !request.source.contentType
        ) {
          request.source.contentType = "text/turtle";
        }
        await client.import(request);
        return {
          success: true,
          message: "Data imported successfully.",
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
