import {
  type CaseContext,
  fixtureQuads as f,
  insertPatch,
  mergeImport,
  sameIds,
  sortedIds,
  storedIds,
  workingEmbeddings,
} from "./commit-conformance-support.ts";
import type { SearchIndexOnImport } from "@/client/search-index/mod.ts";

const textual = [f.one, f.two];

/** importAll merges the fixture import into a fresh subject under `mode`. */
async function importAll(ctx: CaseContext, mode?: SearchIndexOnImport) {
  const subject = await ctx.create({
    searchIndexOnImport: mode,
    embeddingService: workingEmbeddings,
  });
  await subject.commit(insertPatch(f.one, f.two, f.link), mergeImport);
  return subject;
}

/** expectStoredAll fails unless the import wrote all three fixture quads. */
async function expectStoredAll(
  ctx: CaseContext,
  subject: Awaited<ReturnType<typeof importAll>>,
) {
  if (!sameIds(await storedIds(subject), sortedIds([f.one, f.two, f.link]))) {
    ctx.fail("an import must store every inserted quad");
  }
}

/** incremental projects chunks for textual quads during the import itself. */
export async function incrementalCase(ctx: CaseContext): Promise<void> {
  const subject = await importAll(ctx, "incremental");
  await expectStoredAll(ctx, subject);
  if (!sameIds((await subject.chunkedQuadIds()).sort(), sortedIds(textual))) {
    ctx.fail(
      "incremental: expected one chunk per textual quad and none for IRI objects",
    );
  }
  if (subject.fullRebuildCount() !== 0) {
    ctx.fail("incremental: must not run a full rebuild");
  }
}

/** disabled stores quads and writes no chunks, even for ordinary commits. */
export async function disabledCase(ctx: CaseContext): Promise<void> {
  const subject = await importAll(ctx, "disabled");
  await expectStoredAll(ctx, subject);
  await subject.commit(insertPatch(f.three));
  if ((await subject.chunkedQuadIds()).length !== 0) {
    ctx.fail(
      "disabled: no chunk rows may be written, for imports or ordinary commits",
    );
  }
  if (subject.fullRebuildCount() !== 0) {
    ctx.fail("disabled: must not run a full rebuild");
  }
}

/** deferred rebuilds once after an import and projects ordinary commits directly. */
export async function deferredCase(ctx: CaseContext): Promise<void> {
  const subject = await importAll(ctx, "deferred");
  await expectStoredAll(ctx, subject);
  if (subject.fullRebuildCount() !== 1) {
    ctx.fail("deferred: an import must trigger exactly one full rebuild");
  }
  if (!sameIds((await subject.chunkedQuadIds()).sort(), sortedIds(textual))) {
    ctx.fail("deferred: the rebuild must leave one chunk per textual quad");
  }
  await subject.commit(insertPatch(f.three));
  if (subject.fullRebuildCount() !== 1) {
    ctx.fail("deferred: an ordinary commit must not trigger a rebuild");
  }
  if (!(await subject.chunkedQuadIds()).includes(sortedIds([f.three])[0]!)) {
    ctx.fail("deferred: an ordinary commit must project its own chunks");
  }
}

/** the default mode (option unset) behaves as the contract declares. */
export async function defaultModeCase(ctx: CaseContext): Promise<void> {
  const declared = ctx.contract.defaultSearchIndexOnImport;
  const subject = await importAll(ctx, undefined);
  const chunked = (await subject.chunkedQuadIds()).length;
  const rebuilds = subject.fullRebuildCount();
  const expected = {
    incremental: { chunked: textual.length, rebuilds: 0 },
    deferred: { chunked: textual.length, rebuilds: 1 },
    disabled: { chunked: 0, rebuilds: 0 },
  }[declared];
  if (chunked !== expected.chunked || rebuilds !== expected.rebuilds) {
    ctx.fail(
      `default mode: declared "${declared}" expects ${expected.chunked} chunks and ` +
        `${expected.rebuilds} rebuilds, got ${chunked} and ${rebuilds}`,
    );
  }
}

/** writing a stored quad again changes nothing. */
export async function idempotentCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: workingEmbeddings,
  });
  await subject.commit(insertPatch(f.one), mergeImport);
  const before = (await subject.chunkedQuadIds()).length;
  await subject.commit(insertPatch(f.one), mergeImport);
  if (!sameIds(await storedIds(subject), sortedIds([f.one]))) {
    ctx.fail("re-inserting a stored quad must leave it stored exactly once");
  }
  if ((await subject.chunkedQuadIds()).length !== before) {
    ctx.fail("re-inserting a stored quad must not duplicate its chunk rows");
  }
}
