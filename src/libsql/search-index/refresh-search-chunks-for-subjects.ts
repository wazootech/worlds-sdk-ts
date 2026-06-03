import type * as rdfjs from "@rdfjs/types";

import { isTextualLiteral } from "@/client/quad-store/mod.ts";
import { buildSelectTextualLiteralQuadsForSubjects } from "@/libsql/quad-store/libsql-quad-query-builder.ts";
import type { ProjectSearchChunksOptions } from "@/libsql/search-index/project-search-chunks.ts";
import { refreshSearchChunksForQuads } from "@/libsql/search-index/project-search-chunks.ts";
import { quadFromLibsqlRow } from "@/libsql/libsql-quad-row.ts";

/**
 * RefreshSearchChunksForSubjectsResult reports subject-scoped search index refresh counts.
 */
export interface RefreshSearchChunksForSubjectsResult {
  /** subjectCount is the number of distinct subject IRIs refreshed. */
  subjectCount: number;
  /** chunkRowCount is the number of chunk rows written. */
  chunkRowCount: number;
}

/**
 * refreshSearchChunksForSubjects rebuilds FTS/vector rows for all textual-literal quads of the given subjects.
 */
export async function refreshSearchChunksForSubjects(
  subjects: string[],
  options: ProjectSearchChunksOptions,
): Promise<RefreshSearchChunksForSubjectsResult> {
  const uniqueSubjects = Array.from(new Set(subjects));
  if (uniqueSubjects.length === 0) {
    return { subjectCount: 0, chunkRowCount: 0 };
  }

  const lookupChunkSize = options.maxLookupChunkSize ?? 800;
  const quads: rdfjs.Quad[] = [];

  for (let index = 0; index < uniqueSubjects.length; index += lookupChunkSize) {
    const subjectBatch = uniqueSubjects.slice(index, index + lookupChunkSize);
    const query = buildSelectTextualLiteralQuadsForSubjects(subjectBatch);
    const resultSet = await options.client.execute(query);
    for (const row of resultSet.rows) {
      try {
        const reconstructedQuad = quadFromLibsqlRow(row);
        if (isTextualLiteral(reconstructedQuad.object)) {
          quads.push(reconstructedQuad);
        }
      } catch (cause) {
        throw new Error("failed to load textual quads for subject refresh", {
          cause,
        });
      }
    }
  }

  const chunkRowCount = await refreshSearchChunksForQuads(quads, options);
  return {
    subjectCount: uniqueSubjects.length,
    chunkRowCount,
  };
}
