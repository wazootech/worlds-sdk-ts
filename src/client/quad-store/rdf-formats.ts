import type * as rdfjs from "@rdfjs/types";
import {
  MemoryStream,
  parseTurtleQuads,
  serializeTurtle,
  type TurtleFormat,
} from "@wazoo/sparql-engine";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
} from "./quad-store-interface.ts";

/**
 * RdfFormat specifies content type configuration mapping for parser/writer facilities.
 */
export interface RdfFormat {
  contentType: string;
  engineFormat: TurtleFormat;
}

/**
 * FORMATS is a map of content types to supported RdfFormats. The engine's
 * TriG grammar is a Turtle/N-Triples/N-Quads superset, so parsing is uniform
 * across formats; the dialect only constrains serialization. `text/n3` maps
 * to the Turtle writer (the engine covers the N3 subset that is valid
 * Turtle/TriG).
 */
export const FORMATS: Record<string, RdfFormat> = {
  "text/turtle": { contentType: "text/turtle", engineFormat: "turtle" },
  "application/n-quads": {
    contentType: "application/n-quads",
    engineFormat: "n-quads",
  },
  "application/n-triples": {
    contentType: "application/n-triples",
    engineFormat: "n-triples",
  },
  "text/n3": { contentType: "text/n3", engineFormat: "turtle" },
};

/**
 * getFormat resolves the appropriate RdfFormat mapping for the given content type, defaulting to N-Quads.
 */
export function getFormat(contentType: string | undefined): RdfFormat {
  const format = contentType?.toLowerCase() || "application/n-quads";
  return FORMATS[format] || FORMATS["application/n-quads"];
}

/**
 * parseQuads parses serialized RDF into a quad stream for the given content type.
 */
export function parseQuads(
  data: string,
  contentType?: string,
): rdfjs.Stream<rdfjs.Quad> {
  getFormat(contentType);
  return new MemoryStream(parseTurtleQuads(data));
}

/**
 * collectQuadsFromStream drains an RDF/JS quad stream into an array.
 */
export function collectQuadsFromStream(
  stream: rdfjs.Stream<rdfjs.Quad>,
): Promise<rdfjs.Quad[]> {
  const quads: rdfjs.Quad[] = [];
  return new Promise<rdfjs.Quad[]>((resolve, reject) => {
    stream.on("data", (quad: rdfjs.Quad) => quads.push(quad));
    stream.on("end", () => resolve(quads));
    stream.on("error", reject);
  });
}

/**
 * materializeImportQuads collects quads from an import source into an array.
 */
export async function materializeImportQuads(
  source: ImportRequest["source"],
): Promise<rdfjs.Quad[]> {
  if (source.kind === "quads") {
    return Array.from(source.quads);
  }

  if (source.kind === "dataset") {
    return Array.from(source.dataset);
  }

  if (source.kind === "serialized") {
    const parsedStream = parseQuads(source.data, source.contentType);
    return await collectQuadsFromStream(parsedStream);
  }

  throw new Error("Unsupported import source kind");
}

/**
 * exportQuadsResponse formats collected quads according to an export request.
 */
export function exportQuadsResponse(
  quads: rdfjs.Quad[],
  request: ExportRequest,
): ExportResponse {
  if (request.format.kind === "quads") {
    return { kind: "quads", quads };
  }

  if (request.format.kind === "serialized") {
    const contentType = request.format.contentType ?? "application/n-quads";
    const { engineFormat } = getFormat(contentType);

    const data = serializeTurtle(quads, { format: engineFormat });

    return { kind: "serialized", data, contentType };
  }

  throw new Error("Invalid format requested");
}

/**
 * awaitDrainRemoveMatches waits for removeMatches(null, null, null, null) to finish.
 * Used by createRdfjsStoreCommitHandler for replace import commits; durable backends
 * honor isReplaceImportCommit in commitPatchToLibsql and commitPatchToDenokv.
 */
export function awaitDrainRemoveMatches(
  store: rdfjs.Store,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const removalStream = store.removeMatches(null, null, null, null);
    removalStream.on("end", resolve);
    removalStream.on("error", reject);
  });
}
