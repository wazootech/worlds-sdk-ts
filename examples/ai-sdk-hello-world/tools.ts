import type { WorldsSdkInterface } from "@worlds/sdk";
import {
  createExecuteSparqlTool,
  createExportRdfTool,
  createImportRdfTool,
  createSearchWorldTool,
} from "./tools/mod.ts";
import type { ExecuteSparqlOptions } from "./tools/sparql.ts";

// Prior art:
// - https://github.com/comunica/comunica-feature-mcp/blob/e2f1e500/packages/utils-mcp/lib/SparqlMcpServer.ts#L145-L221
//

/**
 * AiSdkToolsOptions defines the configuration options for the AI SDK tools.
 */
export interface AiSdkToolsOptions {
  /**
   * sparql provides configuration overrides specifically targeting the executeSparql tool.
   */
  sparql?: ExecuteSparqlOptions;
}

/**
 * createTools creates AI SDK compatible tools that interact with a Worlds Client.
 *
 * @param client The Worlds Client instance.
 * @param options Configuration options for the provided tools.
 * @returns An object containing the AI SDK tools.
 */
export function createTools(
  client: WorldsSdkInterface,
  options?: AiSdkToolsOptions,
) {
  return {
    searchWorld: createSearchWorldTool(client),
    executeSparql: createExecuteSparqlTool(client, options?.sparql),
    importRdf: createImportRdfTool(client),
    exportRdf: createExportRdfTool(client),
  };
}
