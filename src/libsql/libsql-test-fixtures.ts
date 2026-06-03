import type { Client } from "@libsql/client";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { initializeLibsqlSchema } from "./initialize-libsql-schema.ts";
import { LibsqlSchemaBuilder } from "./schema/libsql-schema-builder.ts";
import { LibsqlSearchQueryBuilder } from "./search-index/libsql-search-query-builder.ts";

export const testLibsqlSchemaBuilder = new LibsqlSchemaBuilder(32);
export const testLibsqlSearchQueryBuilder = new LibsqlSearchQueryBuilder(32);

/** sharedTextSplitter is the default text splitter for LibSQL search commit tests. */
export const sharedTextSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
});

/**
 * setupLibsqlSchemaForTest initializes the LibSQL schema for adapter tests.
 */
export async function setupLibsqlSchemaForTest(
  client: Client,
): Promise<void> {
  await initializeLibsqlSchema(client, testLibsqlSchemaBuilder);
}
