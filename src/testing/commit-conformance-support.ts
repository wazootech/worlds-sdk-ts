import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import { hashQuad } from "@/client/quad-store/mod.ts";
import type { EmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import { FakeEmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import type {
  CommitConformanceSubject,
  CommitConformanceSuiteOptions,
} from "./commit-conformance-types.ts";

const { quad, namedNode, literal } = DataFactory;
const g = namedNode("urn:conformance:g");
const p = namedNode("urn:conformance:p");

/** The fixture quads: three textual quads and one with an IRI object (never chunked). */
export const fixtureQuads = {
  base: quad(namedNode("urn:conformance:base"), p, literal("base text"), g),
  one: quad(namedNode("urn:conformance:one"), p, literal("first text"), g),
  two: quad(namedNode("urn:conformance:two"), p, literal("second text"), g),
  three: quad(namedNode("urn:conformance:three"), p, literal("third text"), g),
  link: quad(namedNode("urn:conformance:link"), p, namedNode("urn:x"), g),
};

/** workingEmbeddings returns a valid 32-dimension vector for every text. */
export const workingEmbeddings: EmbeddingService = new FakeEmbeddingService();

/** failingEmbeddings rejects every call. */
export const failingEmbeddings: EmbeddingService = {
  embed: () => Promise.reject(new Error("embedding service unavailable")),
};

/** CaseContext is what every conformance case receives. */
export type CaseContext = CommitConformanceSuiteOptions & {
  /** fail records a failed expectation. */
  fail: (message: string) => void;
};

/** ids returns the content hash of each quad, sorted for set comparison. */
export function sortedIds(quads: rdfjs.Quad[]): string[] {
  return quads.map(hashQuad).sort();
}

/** storedIds returns the sorted hashes of the quads a subject stores. */
export async function storedIds(
  subject: CommitConformanceSubject,
): Promise<string[]> {
  return sortedIds(await subject.storedQuads());
}

/** sameSet reports whether two sorted id lists are equal. */
export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** insertPatch is a patch that inserts the given quads. */
export function insertPatch(...quads: rdfjs.Quad[]) {
  return { insertions: quads, deletions: [] };
}

/** mergeImport is the context of a merge-mode import. */
export const mergeImport = { importMode: "merge" } as const;

/** replaceImport is the context of a replace-mode import. */
export const replaceImport = { importMode: "replace" } as const;
