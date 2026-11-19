import type * as rdfjs from "@rdfjs/types";

/**
 * RdfjsEventSource is the part of a store mutation's return value the SDK
 * uses: it only listens for `end` and `error`. Node's `EventEmitter` and the
 * `@wazoo/sparql-engine` `RdfStream` both satisfy it.
 */
export interface RdfjsEventSource {
  on(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
}

/**
 * RdfjsStoreLike is the store surface the SDK reads and writes through. It is
 * RDF/JS `Store` with the mutation return types loosened to RdfjsEventSource,
 * so a store whose mutations return a dependency-free stream (as
 * `@wazoo/sparql-engine` 0.5 `MemoryStore` does, with no Node `EventEmitter`)
 * is accepted alongside N3.Store, SqliteStore and LibsqlStore. Every
 * `rdfjs.Store` is also an RdfjsStoreLike.
 */
export interface RdfjsStoreLike
  extends
    Omit<rdfjs.Store, "import" | "remove" | "removeMatches" | "deleteGraph"> {
  import(stream: rdfjs.Stream<rdfjs.Quad>): RdfjsEventSource;
  remove(stream: rdfjs.Stream<rdfjs.Quad>): RdfjsEventSource;
  removeMatches(
    subject?: rdfjs.Term | RegExp | null,
    predicate?: rdfjs.Term | RegExp | null,
    object?: rdfjs.Term | RegExp | null,
    graph?: rdfjs.Term | RegExp | null,
  ): RdfjsEventSource;
  deleteGraph(graph: rdfjs.Quad_Graph | string): RdfjsEventSource;
}
