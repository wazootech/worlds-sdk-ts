import type { Client, InStatement } from "@libsql/client";
import type {
  ChunkRowPayload,
  TextSplitterInterface,
} from "@/client/search-index/quad-chunker/mod.ts";
import { chunkQuads } from "@/client/search-index/quad-chunker/mod.ts";
import type * as rdfjs from "@rdfjs/types";
import { hashQuads } from "@/client/quad-store/mod.ts";
import type { LibsqlClientBaseOptions } from "@/libsql/libsql-client-base-options.ts";
import type { LibsqlSearchQueryBuilder } from "./libsql-search-query-builder.ts";
import { buildSelectLabelLiteralsForSubjects } from "@/libsql/quad-store/libsql-quad-query-builder.ts";

import {
  buildChunkFtsValue,
  resolveLabelPredicates,
} from "./search-chunk-fts.ts";
import { LibsqlBatchExecutor } from "@/libsql/libsql-batch-executor.ts";

export interface ProjectSearchChunksOptions extends LibsqlClientBaseOptions {
  textSplitter: TextSplitterInterface;
  maxWriteBatchSize?: number;
  searchQueryBuilder: LibsqlSearchQueryBuilder;
}

/**
 * projectSearchChunks processes novel quads to create, embed, and store FTS/vector chunks.
 */
export async function projectSearchChunks(
  novelInsertions: rdfjs.Quad[],
  novelQuadIds: string[],
  options: ProjectSearchChunksOptions,
): Promise<void> {
  const resolvedLabelPredicates = resolveLabelPredicates(
    options.labelPredicates,
  );

  const chunkStatements = await buildVectorChunkStatements(
    novelInsertions,
    novelQuadIds,
    options,
    resolvedLabelPredicates,
  );

  if (chunkStatements.length > 0) {
    const writeBatchSize = options.maxWriteBatchSize ?? 500;
    try {
      const executor = new LibsqlBatchExecutor({
        client: options.client,
        writeBatchSize,
      });
      await executor.stage(chunkStatements);
      await executor.flush();
    } catch (cause) {
      throw new Error("failed to execute search chunk sync batch", { cause });
    }
  }
}

/**
 * refreshSearchChunksForQuads deletes existing chunk rows for the given quads and rebuilds FTS/vector projections.
 * Durable `quads` rows are not modified. Returns the number of chunk rows written.
 */
export async function refreshSearchChunksForQuads(
  quads: rdfjs.Quad[],
  options: ProjectSearchChunksOptions,
): Promise<number> {
  if (quads.length === 0) {
    return 0;
  }

  const lookupChunkSize = options.maxLookupChunkSize ?? 800;
  const writeBatchSize = options.maxWriteBatchSize ?? 500;
  const resolvedLabelPredicates = resolveLabelPredicates(
    options.labelPredicates,
  );

  const quadIds = await hashQuads(quads);
  const chunkInsertStatements = await buildVectorChunkStatements(
    quads,
    quadIds,
    options,
    resolvedLabelPredicates,
  );

  const executor = new LibsqlBatchExecutor({
    client: options.client,
    writeBatchSize,
  });

  try {
    await executor.stage(
      buildChunkDeletionStatementsChunked(
        quadIds,
        options.searchQueryBuilder,
        lookupChunkSize,
      ),
    );
    await executor.stage(chunkInsertStatements);
    await executor.flush();
  } catch (cause) {
    throw new Error("failed to refresh search chunks", { cause });
  }

  return chunkInsertStatements.length;
}

function buildChunkDeletionStatementsChunked(
  quadIds: string[],
  queryBuilder: LibsqlSearchQueryBuilder,
  chunkSize: number,
): InStatement[] {
  const statements: InStatement[] = [];
  for (let index = 0; index < quadIds.length; index += chunkSize) {
    const quadIdBatch = quadIds.slice(index, index + chunkSize);
    statements.push(
      queryBuilder.buildDeleteByQuadIds(quadIdBatch),
    );
  }
  return statements;
}

async function loadLabelLiteralsBySubject(
  client: Client,
  subjects: string[],
  labelPredicates: string[],
  lookupChunkSize: number,
): Promise<Map<string, string[]>> {
  const labelLiteralsBySubject = new Map<string, string[]>();
  if (subjects.length === 0 || labelPredicates.length === 0) {
    return labelLiteralsBySubject;
  }

  const uniqueSubjects = Array.from(new Set(subjects));
  for (let index = 0; index < uniqueSubjects.length; index += lookupChunkSize) {
    const subjectBatch = uniqueSubjects.slice(index, index + lookupChunkSize);
    const query = buildSelectLabelLiteralsForSubjects(
      subjectBatch,
      labelPredicates,
    );
    const resultSet = await client.execute(query);
    for (const row of resultSet.rows) {
      const subject = String(row.s);
      const literalValue = String(row.o);
      const existing = labelLiteralsBySubject.get(subject) ?? [];
      existing.push(literalValue);
      labelLiteralsBySubject.set(subject, existing);
    }
  }

  return labelLiteralsBySubject;
}

async function buildVectorChunkStatements(
  quads: rdfjs.Quad[],
  quadIds: string[],
  options: ProjectSearchChunksOptions,
  resolvedLabelPredicates: string[],
): Promise<InStatement[]> {
  const statements: InStatement[] = [];

  let chunks: ChunkRowPayload[];
  try {
    chunks = await chunkQuads(quads, options.textSplitter, quadIds);
  } catch (cause) {
    throw new Error("failed to chunk novel textual facts", { cause });
  }

  if (chunks.length === 0) {
    return [];
  }

  const lookupChunkSize = options.maxLookupChunkSize ?? 800;
  const uniqueSubjects = Array.from(
    new Set(chunks.map((chunk) => chunk.subject)),
  );

  const labelLiteralsBySubject = await loadLabelLiteralsBySubject(
    options.client,
    uniqueSubjects,
    resolvedLabelPredicates,
    lookupChunkSize,
  );

  const chunksWithFtsValue = chunks.map((chunk) => ({
    chunk,
    fts_value: buildChunkFtsValue(chunk, {
      labelLiteralsForSubject: labelLiteralsBySubject.get(chunk.subject) ?? [],
    }),
  }));

  let vectorLookupMap: Map<string, Float32Array | number[]> | undefined;

  if (options.embeddingService) {
    const uniqueTexts = Array.from(
      new Set(
        chunksWithFtsValue.flatMap(({ chunk, fts_value }) => [
          fts_value,
          chunk.value,
        ]),
      ),
    );
    let uniqueVectors: Array<Float32Array | number[]>;
    try {
      uniqueVectors = await options.embeddingService.embed(uniqueTexts);
      for (
        let vectorIndex = 0;
        vectorIndex < uniqueVectors.length;
        vectorIndex++
      ) {
        const projectedVector = uniqueVectors[vectorIndex]!;
        const embeddingLength = projectedVector.length;
        if (embeddingLength !== options.searchQueryBuilder.vectorDimensions) {
          throw new Error(
            `embedding length ${embeddingLength} does not match configured vectorDimensions ${options.searchQueryBuilder.vectorDimensions}`,
          );
        }
      }
    } catch (cause) {
      throw new Error("failed to vectorize literal chunk blocks", { cause });
    }

    vectorLookupMap = new Map<string, Float32Array | number[]>();
    for (let textIndex = 0; textIndex < uniqueTexts.length; textIndex++) {
      vectorLookupMap.set(uniqueTexts[textIndex], uniqueVectors[textIndex]!);
    }
  }

  for (const { chunk, fts_value } of chunksWithFtsValue) {
    const vector = vectorLookupMap?.get(fts_value);
    const vectorJson = vector ? JSON.stringify(Array.from(vector)) : undefined;

    statements.push(
      options.searchQueryBuilder.buildInsertChunk({
        quad_id: chunk.quad_id,
        subject: chunk.subject,
        predicate: chunk.predicate,
        graph: chunk.graph,
        value: chunk.value,
        fts_value,
        vectorJson,
      }),
    );
  }

  return statements;
}
