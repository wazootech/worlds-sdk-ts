import type * as rdfjs from "@rdfjs/types";
import {
  filterQuads,
  hashQuads,
  type QuadFilter,
} from "@/client/quad-store/mod.ts";
import {
  type ChunkAndEmbedOptions,
  chunkAndEmbedQuads,
  type EmbeddedChunk,
} from "./quad-chunker/chunk-and-embed.ts";

/** RebuildScope says which chunk rows one write replaces: every row, or only those of the given quads. */
export type RebuildScope = { all: true } | { hashes: string[] };

/** RebuildPage is one page of stored quads and the cursor of the next one. */
export interface RebuildPage {
  /** quads are the stored quads of this page, in scope or not. */
  quads: rdfjs.Quad[];

  /** next is the cursor of the following page; `undefined` ends the rebuild. */
  next?: unknown;
}

/** ChunkRebuildDriver is the storage half of a rebuild: it pages quads and writes chunk rows. */
export interface ChunkRebuildDriver {
  /** pageQuads reads up to `pageSize` stored quads after the cursor (none on the first call). */
  pageQuads(
    request: { after?: unknown; pageSize: number },
  ): Promise<RebuildPage>;

  /**
   * writePage writes the chunk rows of one page that held in-scope quads. `rows`
   * may be empty. With `{ all: true }` the first call (`first`) must clear every
   * old row before it writes, and later calls only add. With `{ hashes }` it
   * must replace only the rows of those quads and leave every other row alone.
   * A rerun must repair a partial write.
   */
  writePage(
    scope: RebuildScope,
    rows: EmbeddedChunk[],
    first: boolean,
  ): Promise<void>;

  /**
   * finish runs once after every page was embedded and written, for a driver
   * that buffers in `writePage` and applies it all at once (all-or-nothing).
   * It is never called when a page failed. Unscoped, `writePage` is always
   * called at least once; scoped with no in-scope quad, it is never called.
   * Optional.
   */
  finish?(): Promise<void>;
}

/** RebuildSearchIndexOptions tunes one rebuild. */
export interface RebuildSearchIndexOptions {
  /** pageSize is the quads read per page; the adopter picks its own default. Clamped to at least 1. */
  pageSize: number;

  /**
   * scope limits the rebuild to the quads an include/exclude filter matches. A
   * scope with no criteria is not a scope: the rebuild is unscoped.
   */
  scope?: QuadFilter;
}

/** RebuildSearchIndexResult reports what a rebuild did. */
export interface RebuildSearchIndexResult {
  /** processedQuadCount is how many stored quads the rebuild scanned, in scope or not. */
  processedQuadCount: number;

  /** chunkRowCount is how many chunk rows it wrote. */
  chunkRowCount: number;
}

/** hasCriteria is true when one side of a QuadFilter names anything to match. */
function hasCriteria(side: QuadFilter["include"]): boolean {
  return side !== undefined && Object.values(side).some((v) => v?.length);
}

/**
 * rebuildSearchIndex is the page loop every durable backend shares. It pages
 * stored quads through `driver.pageQuads`, keeps the in-scope ones, chunks and
 * embeds each page BEFORE `driver.writePage` (an embedding failure rejects and
 * that page writes nothing), and counts what it scanned and wrote.
 *
 * Unscoped, the first `writePage` clears every old row, so an embedding
 * failure on page 1 changes nothing; a store with no quads still clears once.
 * Scoped (an include or exclude with any criteria), nothing is cleared: each
 * page replaces only the rows of its in-scope quads, by hash. A failure on a
 * later page leaves the earlier pages written; `finish` is for a driver that
 * buffers instead and wants all-or-nothing.
 */
export async function rebuildSearchIndex(
  driver: ChunkRebuildDriver,
  projection: ChunkAndEmbedOptions,
  options: RebuildSearchIndexOptions,
): Promise<RebuildSearchIndexResult> {
  const { scope } = options;
  const scoped = scope !== undefined &&
    (hasCriteria(scope.include) || hasCriteria(scope.exclude));
  const inScope = scoped ? filterQuads(scope) : () => true;
  const pageSize = Math.max(1, options.pageSize);
  const result = { processedQuadCount: 0, chunkRowCount: 0 };
  let first = true;
  let after: unknown;
  for (;;) {
    const page = await driver.pageQuads({ after, pageSize });
    result.processedQuadCount += page.quads.length;
    const quads = page.quads.filter(inScope);
    if (quads.length > 0) {
      const hashes = hashQuads(quads);
      const { rows } = await chunkAndEmbedQuads(quads, hashes, projection);
      await driver.writePage(scoped ? { hashes } : { all: true }, rows, first);
      first = false;
      result.chunkRowCount += rows.length;
    }
    if (page.next === undefined) break;
    after = page.next;
  }
  if (first && !scoped) await driver.writePage({ all: true }, [], true);
  await driver.finish?.();
  return result;
}
