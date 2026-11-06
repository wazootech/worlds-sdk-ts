import type * as rdfjs from "@rdfjs/types";
import type { WorldsSdkInterface } from "@/client/client.ts";
import {
  type ImportRequest,
  materializeImportQuads,
} from "@/client/quad-store/mod.ts";
import type { SearchResult } from "@/client/search-index/mod.ts";
import type { SparqlBinding, SparqlValue } from "@/client/sparql-engine/mod.ts";

const NQUADS = "application/n-quads";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export async function exportQuads(
  sdk: WorldsSdkInterface,
): Promise<rdfjs.Quad[]> {
  const response = await sdk.export({ format: { kind: "quads" } });
  if (response.kind !== "quads") {
    throw new Error("export did not return quads");
  }
  return response.quads;
}

export async function exportSerialized(
  sdk: WorldsSdkInterface,
): Promise<{ data: string; contentType: string }> {
  const response = await sdk.export({
    format: { kind: "serialized", contentType: NQUADS },
  });
  if (response.kind !== "serialized") {
    throw new Error("export did not return serialized data");
  }
  return { data: response.data, contentType: response.contentType };
}

export async function importNquads(
  sdk: WorldsSdkInterface,
  nquads: string,
  mode: ImportRequest["mode"] = "merge",
): Promise<void> {
  await sdk.import({
    mode,
    source: { kind: "serialized", data: nquads, contentType: NQUADS },
  });
}

export async function countNquads(nquads: string): Promise<number> {
  const quads = await materializeImportQuads({
    kind: "serialized",
    data: nquads,
    contentType: NQUADS,
  });
  return quads.length;
}

export function searchResultKey(result: SearchResult): string {
  return JSON.stringify({
    id: result.id,
    subject: result.subject,
    predicate: result.predicate,
    graph: result.graph,
    text: result.text,
  });
}

/** bindingKey canonicalizes a SPARQL binding (order-insensitive key comparison). */
export function bindingKey(binding: SparqlBinding): string {
  const entries = Object.keys(binding).sort().map((variable) => {
    return `${variable}=${valueKey(binding[variable])}`;
  });
  return `{${entries.join(", ")}}`;
}

function valueKey(value: SparqlValue): string {
  switch (value.type) {
    case "uri":
    case "bnode":
      return `${value.type}:${value.value}`;
    case "literal": {
      let key = `literal:${value.value}`;
      if (value["xml:lang"]) key += `@${value["xml:lang"]}`;
      if (value.datatype && value.datatype !== XSD_STRING) {
        key += `^^${value.datatype}`;
      }
      if (value["its:dir"]) key += `[${value["its:dir"]}]`;
      return key;
    }
    case "triple":
      return `triple(${valueKey(value.value.subject)}, ` +
        `${valueKey(value.value.predicate)}, ${valueKey(value.value.object)})`;
  }
}

export function sequenceEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of b) {
    const remaining = (counts.get(value) ?? 0) - 1;
    if (remaining < 0) return false;
    counts.set(value, remaining);
  }
  return true;
}
