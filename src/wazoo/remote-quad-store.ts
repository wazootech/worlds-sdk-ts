import type * as rdfjs from "@rdfjs/types";
import { type Client, exportWorld, importWorld } from "@worlds/client";
import { serializeTurtle } from "@wazoo/sparql-engine";
import { materializeImportQuads } from "@/client/quad-store/rdf-formats.ts";
import type {
  ExportRequest,
  ExportResponse,
  ImportRequest,
  QuadStoreInterface,
} from "@/client/quad-store/mod.ts";

/**
 * RemoteQuadStore implements QuadStoreInterface by delegating to the Worlds
 * data-plane API via @worlds/client.
 *
 * Limitations vs local backends:
 * - `import.mode` is ignored (the API always merges). Replace semantics are
 *   not supported by the data-plane API.
 * - `export` does not support QuadFilter (include/exclude) scoping.
 */
export class RemoteQuadStore implements QuadStoreInterface {
  constructor(
    private readonly client: Client,
    private readonly worldId: string,
  ) {}

  async import(request: ImportRequest): Promise<void> {
    let data: string;
    let contentType: string;

    if (request.source.kind === "serialized") {
      data = request.source.data;
      contentType = request.source.contentType ?? "application/n-quads";
    } else {
      const quads = await materializeImportQuads(request.source);
      data = serializeTurtle(quads, { format: "n-quads" });
      contentType = "application/n-quads";
    }

    const result = await importWorld({
      client: this.client,
      path: { id: this.worldId },
      body: { data, contentType },
    });

    if (result.error) {
      throw new Error(
        `Import failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }
  }

  async export(request: ExportRequest): Promise<ExportResponse> {
    const format = request.format.kind === "serialized"
      ? (request.format.contentType ?? "application/n-quads")
      : undefined;

    const result = await exportWorld({
      client: this.client,
      path: { id: this.worldId },
      query: format ? { format } : undefined,
    });

    if (result.error) {
      throw new Error(
        `Export failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }

    const data = result.data;
    const quads: rdfjs.Quad[] = data.quads.map((q) => apiQuadToRdfjs(q));

    if (request.format.kind === "quads") {
      return { kind: "quads", quads };
    }

    const contentType = request.format.contentType ?? "application/n-quads";
    const serialized = serializeTurtle(quads, { format: "n-quads" });
    return { kind: "serialized", data: serialized, contentType };
  }
}

/**
 * apiQuadToRdfjs converts a Worlds API quad object into an RDF/JS Quad.
 */
function apiQuadToRdfjs(
  q: { subject: string; predicate: string; object: string; graph?: string },
): rdfjs.Quad {
  return {
    termType: "Quad" as const,
    value: "",
    subject: termFromApi(q.subject) as rdfjs.Quad_Subject,
    predicate: termFromApi(q.predicate) as rdfjs.Quad_Predicate,
    object: termFromApi(q.object) as rdfjs.Quad_Object,
    graph: q.graph
      ? termFromApi(q.graph) as rdfjs.Quad_Graph
      : { termType: "DefaultGraph" as const, value: "" } as rdfjs.DefaultGraph,
    equals(other: rdfjs.Term): boolean {
      if (other.termType !== "Quad") return false;
      return this.subject.equals(other.subject) &&
        this.predicate.equals(other.predicate) &&
        this.object.equals(other.object);
    },
  };
}

/**
 * termFromApi converts a string IRI/bnode/literal from the Worlds API
 * into an RDF/JS term.
 */
function termFromApi(value: string): rdfjs.Term {
  if (value.startsWith("_:")) {
    return { termType: "BlankNode", value: value.slice(2) } as rdfjs.Term;
  }

  if (value.startsWith('"')) {
    // Simple literal: "value" or "value"^^<datatype> or "value"@lang
    const match = value.match(
      /^"(.*)"(?:\^\^(<.*>))?(@.*)?$/,
    );
    if (match) {
      const [, lexical, datatype, lang] = match;
      if (lang) {
        return {
          termType: "Literal",
          value: lexical,
          language: lang.slice(1),
          datatype: {
            termType: "NamedNode",
            value: "http://www.w3.org/2001/XMLSchema#string",
          },
        } as rdfjs.Term;
      }
      if (datatype) {
        return {
          termType: "Literal",
          value: lexical,
          language: "",
          datatype: {
            termType: "NamedNode",
            value: datatype,
          },
        } as rdfjs.Term;
      }
      return {
        termType: "Literal",
        value: lexical,
        language: "",
        datatype: {
          termType: "NamedNode",
          value: "http://www.w3.org/2001/XMLSchema#string",
        },
      } as rdfjs.Term;
    }
  }

  return { termType: "NamedNode", value } as rdfjs.Term;
}
