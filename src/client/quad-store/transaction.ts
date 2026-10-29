import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { EventEmitter } from "node:events";
import type { TransactionContext } from "@/client/quad-store/mod.ts";
import { deduplicateBuffers } from "@/client/quad-store/mod.ts";

const { namedNode } = DataFactory;

/** MatchFunction represents a stream-based query against a graph store. */
export type MatchFunction = (
  subject?: rdfjs.Term | null,
  predicate?: rdfjs.Term | null,
  object?: rdfjs.Term | null,
  graph?: rdfjs.Term | null,
) => rdfjs.Stream<rdfjs.Quad>;

/**
 * TransactionOptions configures the handlers used when a transaction commits.
 */
export interface TransactionOptions {
  /** commit persists the deduplicated patch. */
  commit?: (
    patch: import("./patch.ts").Patch,
    context?: TransactionContext,
  ) => Promise<void>;

  /** fallbackCommit runs when commit is omitted. */
  fallbackCommit?: (
    patch: import("./patch.ts").Patch,
    context?: TransactionContext,
  ) => Promise<void>;
}

/**
 * Transaction collects mutations natively before flushing them as a deduplicated Patch.
 * It deeply implements the mutation boundary for an rdfjs.Store, providing rich bulk
 * ingestion without requiring wrapper classes.
 */
export class Transaction {
  private insertBuffer: rdfjs.Quad[] = [];
  private deleteBuffer: rdfjs.Quad[] = [];

  public constructor(
    private readonly options: TransactionOptions,
  ) {}

  /** add buffers a single quad for insertion on the next commit. */
  public add(quad: rdfjs.Quad): this {
    this.insertBuffer.push(quad);
    return this;
  }

  /** addQuad buffers a single quad for insertion on the next commit. */
  public addQuad(quad: rdfjs.Quad): this {
    return this.add(quad);
  }

  /** addQuads buffers multiple quads for insertion on the next commit. */
  public addQuads(quads: rdfjs.Quad[]): this {
    for (const quad of quads) this.insertBuffer.push(quad);
    return this;
  }

  /** removeQuads buffers multiple quads for deletion on the next commit. */
  public removeQuads(quads: rdfjs.Quad[]): this {
    for (const quad of quads) this.deleteBuffer.push(quad);
    return this;
  }

  /** delete buffers a single quad for deletion on the next commit. */
  public delete(quad: rdfjs.Quad): this {
    this.deleteBuffer.push(quad);
    return this;
  }

  /** removeQuad buffers a single quad for deletion on the next commit. */
  public removeQuad(quad: rdfjs.Quad): this {
    return this.delete(quad);
  }

  /** import consumes an RDF/JS stream, buffering all quads for later commit. */
  public import(stream: rdfjs.Stream<rdfjs.Quad>): EventEmitter {
    return bridgeStreamToBuffer(stream, this.insertBuffer);
  }

  /** remove consumes a stream and buffers all quads from it for deletion on commit. */
  public remove(stream: rdfjs.Stream<rdfjs.Quad>): EventEmitter {
    return bridgeStreamToBuffer(stream, this.deleteBuffer);
  }

  /** removeMatches buffers all quads matching the given quad pattern for deletion on commit. */
  public removeMatches(
    match: MatchFunction,
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): EventEmitter {
    const stream = match(subject, predicate, object, graph);
    return bridgeStreamToBuffer(stream, this.deleteBuffer);
  }

  /** deleteGraph buffers all quads in the named graph for deletion on commit. */
  public deleteGraph(
    match: MatchFunction,
    graph: rdfjs.Term | string,
  ): EventEmitter {
    const graphTerm = typeof graph === "string" ? namedNode(graph) : graph;
    return this.removeMatches(match, null, null, null, graphTerm);
  }

  /** commit deduplicates buffers and persists through the configured commitHandler. */
  public async commit(context?: TransactionContext): Promise<void> {
    deduplicateBuffers(this.insertBuffer, this.deleteBuffer);

    if (this.insertBuffer.length === 0 && this.deleteBuffer.length === 0) {
      return;
    }

    const patch = {
      insertions: this.insertBuffer,
      deletions: this.deleteBuffer,
    };

    if (this.options.commit) {
      await this.options.commit(patch, context);
    } else if (this.options.fallbackCommit) {
      await this.options.fallbackCommit(patch, context);
    }

    this.clearBuffer();
  }

  /** rollback discards any uncommitted insertions and deletions. */
  public rollback(): void {
    this.clearBuffer();
  }

  private clearBuffer(): void {
    this.insertBuffer = [];
    this.deleteBuffer = [];
  }
}

/**
 * bridgeStreamToBuffer connects an RDF/JS quad stream to a target buffer array.
 */
function bridgeStreamToBuffer(
  stream: rdfjs.Stream<rdfjs.Quad>,
  targetBuffer: rdfjs.Quad[],
): EventEmitter {
  const emitter = new EventEmitter();

  stream.on("data", (quad: rdfjs.Quad) => {
    targetBuffer.push(quad);
  });

  stream.on("end", () => {
    emitter.emit("end");
  });

  stream.on("error", (error: Error) => {
    emitter.emit("error", error);
  });

  return emitter;
}

export { createRdfjsStoreCommitHandler } from "./rdfjs-store-commit-handler.ts";
