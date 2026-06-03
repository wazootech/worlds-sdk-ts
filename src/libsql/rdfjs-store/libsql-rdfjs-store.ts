import type { Client } from "@libsql/client";
import type * as rdfjs from "@rdfjs/types";
import { Readable } from "node:stream";
import {
  buildCountQuadsQuery,
  buildMatchQuadsQuery,
} from "@/libsql/quad-store/libsql-quad-query-builder.ts";
import { DEFAULT_LIBSQL_MATCH_PAGE_SIZE } from "@/libsql/quad-store/libsql-quad-query-builder.ts";

import { quadFromLibsqlRow } from "@/libsql/libsql-quad-row.ts";

/**
 * LibsqlRdfjsStoreOptions configures LibsqlRdfjsStore dependencies and read behavior.
 */
export interface LibsqlRdfjsStoreOptions {
  /** client is the LibSQL client. */
  client: Client;

  /** queryBuilder is the LibsqlQueryBuilder. */

  /** matchPageSize limits rows per match SQL round-trip (default 1000). */
  matchPageSize?: number;
}

/**
 * LibsqlRdfjsStore is a stateless RDF/JS ReadSource backed by LibSQL and quad covering indexes.
 * All triple/quad patterns resolve via a single SQL index seek with no in-memory hydration needed.
 * This class only implements match and countQuads. Mutative operations are handled via QuadTransaction.
 */
export class LibsqlRdfjsStore {
  private readonly matchPageSize: number;

  public constructor(
    private readonly options: LibsqlRdfjsStoreOptions,
  ) {
    const configuredPageSize = options.matchPageSize ??
      DEFAULT_LIBSQL_MATCH_PAGE_SIZE;
    this.matchPageSize = Math.max(1, Math.floor(configuredPageSize));
  }

  /**
   * match returns a stream of quads matching the given quad pattern.
   * Automatically selects the optimal quad index covering index based on
   * which pattern positions are bound. Reads are keyset-paged by quad id.
   */
  public match(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): rdfjs.Stream<rdfjs.Quad> {
    const pattern = {
      subject: subject ?? null,
      predicate: predicate ?? null,
      object: object ?? null,
      graph: graph ?? null,
    };

    let afterQuadId: string | undefined;
    let streamFinished = false;

    const rowStream = new Readable({
      objectMode: true,
      read: async () => {
        if (streamFinished) {
          return;
        }

        try {
          const { sql, args } = buildMatchQuadsQuery(
            pattern,
            {
              afterQuadId,
              limit: this.matchPageSize,
            },
          );
          const resultSet = await this.options.client.execute({ sql, args });

          if (resultSet.rows.length === 0) {
            rowStream.push(null);
            streamFinished = true;
            return;
          }

          for (const row of resultSet.rows) {
            afterQuadId = String(row.id);
            rowStream.push(quadFromLibsqlRow(row));
          }

          if (resultSet.rows.length < this.matchPageSize) {
            rowStream.push(null);
            streamFinished = true;
          }
        } catch (error) {
          rowStream.destroy(error as Error);
          streamFinished = true;
        }
      },
    });

    return rowStream as unknown as rdfjs.Stream<rdfjs.Quad>;
  }

  /**
   * countQuads returns the number of quads matching the given quad pattern (Comunica cardinality hint).
   */
  public async countQuads(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): Promise<number> {
    const { sql, args } = buildCountQuadsQuery({
      subject: subject ?? null,
      predicate: predicate ?? null,
      object: object ?? null,
      graph: graph ?? null,
    });
    const resultSet = await this.options.client.execute({ sql, args });
    const firstRow = resultSet.rows[0];
    if (!firstRow) {
      return 0;
    }
    const countValue = firstRow.count ?? firstRow["COUNT(*)"];
    return Number(countValue ?? 0);
  }
}
