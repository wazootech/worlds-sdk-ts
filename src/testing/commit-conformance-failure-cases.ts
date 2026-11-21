import {
  type CaseContext,
  failingEmbeddings,
  fixtureQuads as f,
  insertPatch,
  mergeImport,
  rejects,
  replaceImport,
  sameIds,
  sortedIds,
  storedIds,
  workingEmbeddings,
} from "./commit-conformance-support.ts";

/** an embedding failure rejects the commit and writes nothing. */
export async function embeddingFailureCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: failingEmbeddings,
  });
  const failed = await rejects(() =>
    subject.commit(insertPatch(f.one), mergeImport)
  );
  const stored = (await subject.storedQuads()).length;
  const chunks = (await subject.chunkedQuadIds()).length;
  if (!failed) ctx.fail("embedding failure: expected the commit to reject");
  if (stored !== 0 || chunks !== 0) {
    ctx.fail(
      `embedding failure: nothing may be written, found ${stored} quads and ${chunks} chunks`,
    );
  }
}

/** a failed write leaves no orphan chunks, and nothing new at all when atomic. */
export async function writeFailureCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: workingEmbeddings,
  });
  await subject.commit(insertPatch(f.base), mergeImport);
  subject.failNextWrite();
  if (
    !(await rejects(() =>
      subject.commit(insertPatch(f.one, f.two), mergeImport)
    ))
  ) {
    ctx.fail("write failure: expected the commit to reject");
  }
  const stored = await storedIds(subject);
  const chunked = [...new Set(await subject.chunkedQuadIds())].sort();
  if (!stored.includes(sortedIds([f.base])[0]!)) {
    ctx.fail("write failure: the previously committed quad must survive");
  }
  if (ctx.contract.atomic) {
    if (
      !sameIds(stored, sortedIds([f.base])) ||
      !sameIds(chunked, sortedIds([f.base]))
    ) {
      ctx.fail(
        "write failure: an atomic backend must leave exactly the prior state",
      );
    }
  } else if (chunked.some((id) => !stored.includes(id))) {
    ctx.fail("write failure: a chunk row refers to a quad that is not stored");
  }
}

/** a failed replace import leaves the old graph or an empty one, as declared, never orphans. */
export async function replaceFailureCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: workingEmbeddings,
  });
  await subject.commit(insertPatch(f.base, f.three), mergeImport);
  subject.failNextWrite();
  if (
    !(await rejects(() => subject.commit(insertPatch(f.one), replaceImport)))
  ) {
    ctx.fail("replace failure: expected the import to reject");
  }
  const stored = await storedIds(subject);
  const chunked = [...new Set(await subject.chunkedQuadIds())].sort();
  const expected = ctx.contract.replaceImportFailure === "keeps-old-graph"
    ? sortedIds([f.base, f.three])
    : [];
  if (!sameIds(stored, expected) || !sameIds(chunked, expected)) {
    ctx.fail(
      `replace failure: declared "${ctx.contract.replaceImportFailure}" expects ${expected.length} quads and chunks, ` +
        `found ${stored.length} quads and ${chunked.length} chunked`,
    );
  }
}

/** a quad deleted and re-inserted in one patch stays stored, with its chunk. */
export async function deleteAndReinsertCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: workingEmbeddings,
  });
  await subject.commit(insertPatch(f.base), mergeImport);
  await subject.commit({ insertions: [f.base], deletions: [f.base] });
  if (!sameIds(await storedIds(subject), sortedIds([f.base]))) {
    ctx.fail("delete + re-insert: the quad must remain stored exactly once");
  }
  if (!(await subject.chunkedQuadIds()).includes(sortedIds([f.base])[0]!)) {
    ctx.fail("delete + re-insert: the quad must keep a chunk row");
  }
}
