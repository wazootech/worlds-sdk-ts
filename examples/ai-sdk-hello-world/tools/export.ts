import { tool } from "ai";
import type { ClientInterface } from "@worlds/sdk";
import type { ExportRequest } from "@worlds/sdk/quad-store";
import { z } from "zod";

/**
 * SerializedExportRequest is a discriminated ExportRequest type that only allows "serialized" formats.
 */
export type SerializedExportRequest = Omit<ExportRequest, "format"> & {
  format: Extract<ExportRequest["format"], { kind: "serialized" }>;
};

/**
 * createExportRdfTool creates an AI SDK tool for exporting data from the knowledge base.
 *
 * @param client The Worlds Client instance.
 * @returns An AI SDK tool for exporting data from the knowledge base.
 */
export function createExportRdfTool(client: ClientInterface) {
  return tool({
    description:
      "Export the entire knowledge base graph as serialized RDF data (like Turtle or N-Triples). Use this as a safety hatch or when a full system dump is explicitly requested.",
    inputSchema: z.object({
      format: z.object({
        kind: z.literal("serialized").describe("Desired output format."),
        contentType: z.string().optional().describe(
          "The MIME type of the exported data. Usually 'text/turtle' or 'application/n-triples'.",
        ),
      }),
    }),
    execute: async (request: SerializedExportRequest) => {
      try {
        if (
          request.format.kind === "serialized" && !request.format.contentType
        ) {
          request.format.contentType = "text/turtle";
        }
        const response = await client.export(request);
        return {
          success: true,
          data: response.kind === "serialized" ? response.data : null,
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
