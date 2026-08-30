import type * as rdfjs from "@rdfjs/types";
import { type Client, sparqlWorld } from "@worlds/client";
import type {
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
} from "@/client/sparql-engine/mod.ts";
import { parseNQuadsTerm } from "./term-parser.ts";

/**
 * RemoteSparqlEngine implements SparqlEngineInterface by delegating to the
 * Worlds data-plane API via @worlds/client.
 *
 * Limitations vs local engines:
 * - `baseIri`, `timeoutMs`, and `signal` are ignored. The API determines
 *   timeout and does not support abort signals.
 */
export class RemoteSparqlEngine implements SparqlEngineInterface {
  constructor(
    private readonly client: Client,
    private readonly worldId: string,
  ) {}

  async execute(request: SparqlRequest): Promise<SparqlResponse> {
    const result = await sparqlWorld({
      client: this.client,
      path: { id: this.worldId },
      body: { query: request.query },
    });

    if (result.error) {
      throw new Error(
        `SPARQL failed: ${result.error.error.code} — ${result.error.error.message}`,
      );
    }

    return parseSparqlResponse(result.data);
  }
}

/**
 * parseSparqlResponse interprets the raw JSON response from the Worlds API
 * and returns a typed SparqlResponse.
 */
function parseSparqlResponse(data: unknown): SparqlResponse {
  if (!data || typeof data !== "object") {
    return { kind: "void" };
  }

  const obj = data as Record<string, unknown>;

  // SELECT results: { head: { vars }, results: { bindings } }
  if (
    obj.head && typeof obj.head === "object" &&
    "vars" in obj.head &&
    obj.results && typeof obj.results === "object" &&
    "bindings" in obj.results
  ) {
    const head = obj.head as { vars: string[]; link?: string[] };
    const results = obj.results as {
      bindings: Array<Record<string, unknown>>;
    };

    return {
      kind: "select",
      data: {
        head: { vars: head.vars, link: head.link },
        results: {
          bindings: results.bindings.map((b) =>
            parseBindings(b) as Record<
              string,
              import("@wazoo/sparql-engine").SparqlValue
            >
          ),
        },
      },
    };
  }

  // ASK results: { head: {}, boolean: true/false }
  if ("boolean" in obj && typeof obj.boolean === "boolean") {
    return {
      kind: "ask",
      data: {
        head: { link: undefined },
        boolean: obj.boolean,
      },
    };
  }

  // CONSTRUCT results: { head: {}, quads: [...] }
  if ("quads" in obj && Array.isArray(obj.quads)) {
    return {
      kind: "construct",
      data: {
        quads: obj.quads.map((q: Record<string, unknown>) => quadFromApi(q)),
      },
    };
  }

  return { kind: "void" };
}

function parseBindings(
  raw: Record<string, unknown>,
): Record<string, import("@wazoo/sparql-engine").SparqlValue> {
  const result: Record<string, import("@wazoo/sparql-engine").SparqlValue> = {};
  for (const [key, val] of Object.entries(raw)) {
    result[key] = sparqlValueFromApi(val as Record<string, unknown>);
  }
  return result;
}

function sparqlValueFromApi(
  val: Record<string, unknown>,
): import("@wazoo/sparql-engine").SparqlValue {
  const type = val.type as string;
  const value = val.value as string;

  if (type === "uri") {
    return { type: "uri", value };
  }
  if (type === "bnode") {
    return { type: "bnode", value };
  }
  if (type === "literal") {
    return {
      type: "literal",
      value,
      "xml:lang": (val["xml:lang"] as string) || undefined,
      datatype: (val.datatype as string) || undefined,
    };
  }
  if (type === "triple") {
    const tripleVal = val.value as Record<string, unknown>;
    return {
      type: "triple",
      value: {
        subject: sparqlValueFromApi(
          tripleVal.subject as Record<string, unknown>,
        ),
        predicate: sparqlValueFromApi(
          tripleVal.predicate as Record<string, unknown>,
        ),
        object: sparqlValueFromApi(
          tripleVal.object as Record<string, unknown>,
        ),
      },
    };
  }

  return { type: "uri", value: String(value) };
}

function quadFromApi(q: Record<string, unknown>): rdfjs.Quad {
  return {
    termType: "Quad",
    value: "",
    subject: parseNQuadsTerm(q.subject as string),
    predicate: parseNQuadsTerm(q.predicate as string),
    object: parseNQuadsTerm(q.object as string),
    graph: q.graph
      ? parseNQuadsTerm(q.graph as string)
      : { termType: "DefaultGraph", value: "" },
    equals(other: rdfjs.Term): boolean {
      if (other.termType !== "Quad") return false;
      return this.subject.equals(other.subject) &&
        this.predicate.equals(other.predicate) &&
        this.object.equals(other.object);
    },
  } as rdfjs.Quad;
}
