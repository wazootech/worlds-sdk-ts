import type * as rdfjs from "@rdfjs/types";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
  SparqlSelectResults,
  SparqlValue,
} from "@/client/sparql-engine/mod.ts";

/**
 * ComunicaQueryEngine is the minimal structural query contract needed from a user-provided Comunica engine.
 */
export interface ComunicaQueryEngine {
  /** query executes a raw SPARQL operation against RDFJS-compatible sources. */
  query(
    query: string,
    options: ComunicaQueryOptions,
  ): Promise<unknown>;
}

/**
 * ComunicaQueryOptions contains the RDFJS sources and base IRI passed to a Comunica-compatible engine.
 */
export interface ComunicaQueryOptions {
  /** sources contains the RDFJS stores available to the query engine. */
  sources: rdfjs.Store[];

  /** baseIRI is the optional base IRI used during SPARQL execution. */
  baseIRI?: string;
}

/**
 * ComunicaQueryResult is the minimal result shape returned by a Comunica-compatible query engine.
 */
export interface ComunicaQueryResult {
  /** resultType identifies the kind of query result returned by the engine. */
  resultType: string;

  /** execute materializes the query result payload. */
  execute(): Promise<unknown>;

  /** metadata optionally returns variable metadata for binding result streams. */
  metadata?: () => Promise<{ variables: rdfjs.Variable[] }>;
}

/**
 * ComunicaEventStream is the minimal event stream contract consumed from Comunica result streams.
 */
export interface ComunicaEventStream<T> {
  /** on registers a listener for streamed data items. */
  on(event: "data", listener: (item: T) => void): this;

  /** on registers a listener for stream completion. */
  on(event: "end", listener: () => void): this;

  /** on registers a listener for stream failures. */
  on(event: "error", listener: (error: unknown) => void): this;
}

/**
 * ComunicaBinding is the minimal binding shape consumed from Comunica binding streams.
 */
export interface ComunicaBinding {
  /** get optionally resolves a variable binding by name. */
  get?: (variable: string) => rdfjs.Term | undefined;
}

import { TransactionalRdfjsStore } from "@/client/quad-store/mod.ts";
import type { ReadonlyStore, Transaction } from "@/client/quad-store/mod.ts";

/**
 * ComunicaSparqlEngineOptions are the options for ComunicaSparqlEngine.
 */
export interface ComunicaSparqlEngineOptions {
  /**
   * store is the RDFJS store to execute the query on.
   * For join cardinality hints, pass a store that implements `countQuads` (e.g. `LibsqlRdfjsStore` from `createLibsqlClient`).
   */
  store: rdfjs.Store;

  /** queryEngine is the caller-provided Comunica-compatible query engine to use. */
  queryEngine: ComunicaQueryEngine;

  /**
   * createTransaction is an optional factory to create a Transaction for SPARQL UPDATEs.
   */
  createTransaction?: () => Transaction;
}

/**
 * ComunicaSparqlEngine is the standard implementation of SparqlEngineInterface
 * that uses the Comunica engine over a local RDFJS store.
 */
export class ComunicaSparqlEngine implements SparqlEngineInterface {
  public constructor(
    private readonly options: ComunicaSparqlEngineOptions,
  ) {}

  public async execute(request: SparqlRequest): Promise<SparqlResponse> {
    let tx: Transaction | undefined;
    let storeForQuery: rdfjs.Store = this.options.store;

    if (this.options.createTransaction) {
      tx = this.options.createTransaction();
      storeForQuery = new TransactionalRdfjsStore({
        readStore: this.options
          .store as ReadonlyStore,
        transaction: tx,
      });
    }

    try {
      const response = await executeSparql(
        this.options.queryEngine,
        storeForQuery,
        request,
      );

      if (response.kind === "void") {
        await tx?.commit();
      }

      return response;
    } catch (error) {
      tx?.rollback();
      throw error;
    }
  }
}

/** Default timeout for SPARQL queries (30 seconds). */
const DEFAULT_SPARQL_TIMEOUT_MS = 30_000;

/**
 * executeSparql executes a SPARQL query on an RDFJS Store.
 *
 * @param store The RDFJS Store to execute the query on.
 * @param request The SPARQL query request.
 * @returns The SPARQL query response.
 */
export async function executeSparql(
  queryEngine: ComunicaQueryEngine,
  store: rdfjs.Store,
  request: SparqlRequest,
): Promise<SparqlResponse> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_SPARQL_TIMEOUT_MS;
  return await new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    timer = setTimeout(() => {
      clearTimer();
      reject(new Error("SPARQL query timed out"));
    }, timeoutMs);

    queryEngine.query(request.query, {
      sources: [store],
      baseIRI: request.baseIri,
    }).then(async (queryResult) => {
      clearTimer();

      try {
        const queryType = queryResult as ComunicaQueryResult;
        switch (queryType.resultType) {
          case "void": {
            // Note: resultType 'void' indicates an Update operation complete
            await queryType.execute();
            return resolve({ kind: "void" });
          }
          case "bindings": {
            const results = await handleBindings(
              queryType,
            );
            return resolve({ kind: "select", data: results });
          }
          case "boolean": {
            const results = await handleBoolean(
              queryType,
            );
            return resolve({ kind: "ask", data: results });
          }
          // TODO: Implement "quads" case to drain result stream and resolve as { kind: "construct", data: rdfjs.Quad[] }
          default:
            return reject(
              new Error(
                `Query result type '${queryType.resultType}' (e.g. CONSTRUCT/DESCRIBE) is not supported currently`,
              ),
            );
        }
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      clearTimer();
      reject(error);
    });
  });
}

async function handleBindings(
  queryType: ComunicaQueryResult,
): Promise<SparqlSelectResults> {
  if (!queryType.metadata) {
    throw new Error("SPARQL bindings result is missing metadata.");
  }

  const bindingsStream = await queryType.execute() as ComunicaEventStream<
    ComunicaBinding
  >;
  const vars = (await queryType.metadata()).variables.map((v) => v.value);

  const bindings = await new Promise<SparqlBinding[]>((resolve, reject) => {
    const b: SparqlBinding[] = [];
    let finished = false;

    const onData = (binding: ComunicaBinding) => {
      if (finished) return;
      const bindingObj: SparqlBinding = {};
      for (const v of vars) {
        const term = binding.get?.(v);
        if (term) {
          bindingObj[v] = toSparqlValue(term);
        }
      }
      b.push(bindingObj);
    };

    const onEnd = () => {
      if (!finished) {
        finished = true;
        resolve(b);
      }
    };

    const onError = (error: unknown) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    };

    bindingsStream.on("data", onData);
    bindingsStream.on("end", onEnd);
    bindingsStream.on("error", onError);
  });

  return {
    head: { vars, link: undefined },
    results: { bindings },
  };
}

async function handleBoolean(
  queryType: ComunicaQueryResult,
): Promise<SparqlAskResults> {
  const boolean = await queryType.execute();
  if (typeof boolean !== "boolean") {
    throw new Error("SPARQL boolean result returned a non-boolean payload.");
  }

  return {
    head: { link: undefined },
    boolean,
  };
}

function toSparqlValue(term: rdfjs.Term): SparqlValue {
  const type = term.termType;
  const value = term.value;

  if (type === "NamedNode") {
    return { type: "uri", value };
  }
  if (type === "BlankNode") {
    return { type: "bnode", value };
  }

  if (type === "Quad") {
    return {
      type: "triple",
      value: {
        subject: toSparqlValue(term.subject),
        predicate: toSparqlValue(term.predicate),
        object: toSparqlValue(term.object),
      },
    };
  }

  const literalTerm = term as rdfjs.Literal;
  const val: SparqlValue = {
    type: "literal",
    value,
  };

  if (literalTerm.language) {
    val["xml:lang"] = literalTerm.language;
  }

  if (
    literalTerm.datatype &&
    literalTerm.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
  ) {
    val.datatype = literalTerm.datatype.value;
  }

  return val;
}
