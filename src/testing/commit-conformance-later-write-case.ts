import {
  type CaseContext,
  fixtureQuads as f,
  insertPatch,
  mergeImport,
  rejects,
  sameIds,
  sortedIds,
  storedIds,
  workingEmbeddings,
} from "./commit-conformance-support.ts";

/**
 * a failure in a write after the quad writes either rolls the quads back
 * (atomic) or is cleaned up, as declared. Skipped without `failLaterWrite`.
 */
export async function laterWriteFailureCase(ctx: CaseContext): Promise<void> {
  const subject = await ctx.create({
    searchIndexOnImport: "incremental",
    embeddingService: workingEmbeddings,
  });
  if (!subject.failLaterWrite) {
    ctx.skip(
      "later-write failure: skipped, the subject does not implement failLaterWrite",
    );
    return;
  }
  await subject.commit(insertPatch(f.base), mergeImport);
  subject.failLaterWrite();
  if (
    !(await rejects(() =>
      subject.commit(insertPatch(f.one, f.two), mergeImport)
    ))
  ) {
    ctx.fail("later-write failure: expected the commit to reject");
  }
  const stored = await storedIds(subject);
  const chunked = [...new Set(await subject.chunkedQuadIds())].sort();
  const prior = sortedIds([f.base]);
  const keeps = !ctx.contract.atomic &&
    ctx.contract.laterWriteFailure === "keeps-written-quads";
  if (!stored.includes(prior[0]!)) {
    ctx.fail("later-write failure: the previously committed quad must survive");
  }
  if (!keeps && (!sameIds(stored, prior) || !sameIds(chunked, prior))) {
    ctx.fail(
      `later-write failure: expected exactly the prior state (${
        ctx.contract.atomic ? "atomic backends roll back" : "cleanup removes"
      } the failed commit), found ${stored.length} quads and ${chunked.length} chunked`,
    );
  } else if (chunked.some((id) => !stored.includes(id))) {
    ctx.fail(
      "later-write failure: a chunk row refers to a quad that is not stored",
    );
  }
  await subject.commit(insertPatch(f.one), mergeImport);
  const after = await storedIds(subject);
  if (![f.base, f.one].every((quad) => after.includes(sortedIds([quad])[0]!))) {
    ctx.fail("later-write failure: the store must accept a commit afterwards");
  }
}
