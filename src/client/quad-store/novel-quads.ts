import type * as rdfjs from "@rdfjs/types";
import type { Patch } from "./patch.ts";
import { filterQuads, type QuadFilter } from "./quad-filter.ts";
import { hashQuads } from "./hash-quad.ts";

/**
 * PreparedPatch is a patch after the pure, fallible work every durable commit
 * starts with: the include/exclude filter and content-addressed hashing.
 * Nothing in it has touched a store, so a throw while preparing leaves the
 * store untouched (even before a replace-import wipe).
 */
export interface PreparedPatch {
  /** deletions are the patch's deletions that passed the filter. */
  deletions: rdfjs.Quad[];

  /** deletionIds are the content hashes of `deletions`, index for index. */
  deletionIds: string[];

  /** insertions are the patch's insertions that passed the filter. */
  insertions: rdfjs.Quad[];

  /** insertionIds are the content hashes of `insertions`, index for index. */
  insertionIds: string[];
}

/**
 * preparePatch applies the include/exclude filter to both sides of a patch and
 * hashes what is left. It does not deduplicate within a side: the same quad
 * inserted twice appears twice, as in every durable backend today.
 */
export function preparePatch(patch: Patch, filter?: QuadFilter): PreparedPatch {
  const matches = filterQuads(filter);
  const deletions = patch.deletions?.filter(matches) ?? [];
  const insertions = patch.insertions?.filter(matches) ?? [];
  return {
    deletions,
    deletionIds: deletions.length ? hashQuads(deletions) : [],
    insertions,
    insertionIds: insertions.length ? hashQuads(insertions) : [],
  };
}

/** SelectNovelQuadsOptions tells selectNovelQuads how to ask a store what it already holds. */
export interface SelectNovelQuadsOptions {
  /**
   * lookupExisting returns which of `keys` the store already holds. It is
   * called once with every insertion key (duplicates included), so a backend
   * does its own chunking by `maxLookupChunkSize`. It is not called when there
   * are no insertions or when `replacing` is true.
   */
  lookupExisting: (keys: string[]) => Promise<Set<string>>;

  /**
   * keyOf is the identity the store uses to recognise a quad. Defaults to the
   * content hash. A backend keyed on something else (SQLite's term-keyed
   * rows) returns that key here, and `lookupExisting` receives the same keys.
   */
  keyOf?: (quad: rdfjs.Quad, id: string) => string;

  /**
   * replacing is true for a replace-mode import. The commit wipes the store, so
   * nothing existing counts and no lookup is made. A backend that wipes before
   * it looks up gets the same result without this flag.
   */
  replacing?: boolean;
}

/** NovelQuads are the insertions a commit must actually write, with their hashes. */
export interface NovelQuads {
  /** novelInsertions are the quads to write. */
  novelInsertions: rdfjs.Quad[];

  /** novelQuadIds are the content hashes of `novelInsertions`, index for index. */
  novelQuadIds: string[];
}

/**
 * selectNovelQuads keeps an insertion when the store does not hold it yet, or
 * when the same patch also deletes it (delete-then-re-add must write it back).
 * This is the deduplication rule of `@worlds/libsql`, the reference backend.
 */
export async function selectNovelQuads(
  prepared: PreparedPatch,
  options: SelectNovelQuadsOptions,
): Promise<NovelQuads> {
  const keyOf = options.keyOf ?? ((_quad, id) => id);
  const { insertions, insertionIds, deletions, deletionIds } = prepared;
  if (insertions.length === 0) return { novelInsertions: [], novelQuadIds: [] };

  const insertionKeys = insertions.map((q, i) => keyOf(q, insertionIds[i]!));
  const deletedKeys = new Set(
    deletions.map((q, i) => keyOf(q, deletionIds[i]!)),
  );
  const existing = options.replacing
    ? new Set<string>()
    : await options.lookupExisting(insertionKeys);

  const novelInsertions: rdfjs.Quad[] = [];
  const novelQuadIds: string[] = [];
  for (let i = 0; i < insertions.length; i++) {
    const key = insertionKeys[i]!;
    if (!existing.has(key) || deletedKeys.has(key)) {
      novelInsertions.push(insertions[i]!);
      novelQuadIds.push(insertionIds[i]!);
    }
  }
  return { novelInsertions, novelQuadIds };
}

/**
 * computeNovelQuads is preparePatch followed by selectNovelQuads, for backends
 * with no write between the two. Backends that wipe on replace-import hash
 * first and look up after the wipe call the two steps separately.
 */
export async function computeNovelQuads(
  patch: Patch,
  options: SelectNovelQuadsOptions & QuadFilter,
): Promise<PreparedPatch & NovelQuads> {
  const { include, exclude } = options;
  const prepared = preparePatch(patch, { include, exclude });
  return { ...prepared, ...(await selectNovelQuads(prepared, options)) };
}
