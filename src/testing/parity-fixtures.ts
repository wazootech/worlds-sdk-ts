import type { SearchRequest } from "@/client/search-index/mod.ts";
import type { SparqlValue } from "@/client/sparql-engine/mod.ts";

/**
 * Parity fixtures are the shared corpus every durable backend runs in its
 * phase-4 parity suite (per the shared parity/benchmark suite definition,
 * wazootech/workspace#72). Fixtures are plain data — N-Quads serialized
 * strings parsed by the engine's TriG-superset grammar — so the corpus is
 * backend-agnostic and versionable with the seam package.
 */

/**
 * SparqlExpectation is a hand-authored SPARQL result for a fixture query.
 * SPARQL semantics are engine-independent, so these are the reliable
 * deterministic expectations; search ranking is not (bm25 vs ts_rank_cd vs
 * vector distance), so search cases are compared candidate-vs-reference
 * instead of against authored snapshots.
 */
export type SparqlExpectation =
  | { kind: "select"; bindings: Array<Record<string, SparqlValue>> }
  | { kind: "ask"; boolean: boolean };

/** A search case: the same request runs against both Sdks; results must match. */
export interface ParitySearchCase {
  /** name identifies the case in the parity report. */
  name: string;
  /** request is the search executed against both Sdks. */
  request: SearchRequest;
}

/** A SPARQL case: the query runs against both Sdks and must match the authored expectation. */
export interface ParitySparqlCase {
  /** name identifies the case in the parity report. */
  name: string;
  /** query is the SPARQL query executed against both Sdks. */
  query: string;
  /** expected is the hand-authored result both Sdks must satisfy. */
  expected: SparqlExpectation;
}

/**
 * gate controls corpus strictness:
 * - "reference" (default): the case must pass on the reference Sdk (libsql)
 *   and on the candidate. New fixtures default here.
 * - "declared": the corpus category is declared but the durable reference does
 *   not support it yet (e.g. RDF-star storage — the backend-neutral Term
 *   layer still throws "Unsupported term type: Quad"). The case runs and is
 *   reported, but never fails the suite until the reference lands support.
 */
export type ParityGate = "reference" | "declared";

/** ParityFixture is one world in the corpus plus its cases. */
export interface ParityFixture {
  /** name identifies the fixture in the parity report. */
  name: string;
  /** nquads is the world serialized as N-Quads (engine TriG-superset grammar). */
  nquads: string;
  /** totalQuads is the exact quad count after a merge import. */
  totalQuads: number;
  /** graphSizes maps graph term values ("" = default graph) to exact quad counts. */
  graphSizes?: Record<string, number>;
  /** search compares the candidate's results to the reference's (order-sensitive by default). */
  search?: ParitySearchCase[];
  /** sparql runs against both Sdks and must match the authored expectation. */
  sparql?: ParitySparqlCase[];
  /** gate controls strictness; defaults to "reference". */
  gate?: ParityGate;
}

/** ParityReplaceCase exercises replace-mode imports: `second` must fully replace `first`. */
export interface ParityReplaceCase {
  /** name identifies the case in the parity report. */
  name: string;
  /** first is imported with replace mode first. */
  first: string;
  /** second is imported with replace mode second. */
  second: string;
  /** resultCount is the exact quad count after the second replace import. */
  resultCount: number;
}

/** ParityCorpus is the full fixture registry consumed by runParitySuite. */
export interface ParityCorpus {
  fixtures: ParityFixture[];
  replaceCases: ParityReplaceCase[];
}

const XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * multiGraphWorld exercises the one-world-many-graphs guarantee
 * (wazootech/workspace#71): default-graph quads plus named public and private
 * graphs with overlapping subjects, searchable and queryable per graph.
 */
export const multiGraphWorld: ParityFixture = {
  name: "multiGraphWorld",
  nquads: [
    '<urn:alice> <urn:likes> "sailing"@en .',
    '<urn:alice> <urn:age> "42"^^<' + XSD + "integer> .",
    '<urn:alice> <urn:posted> "alice wrote a public note" <urn:graph:public> .',
    '<urn:bob> <urn:posted> "bob is public too" <urn:graph:public> .',
    '<urn:alice> <urn:stores> "confidential key material for alice" <urn:graph:private> .',
  ].join("\n"),
  totalQuads: 5,
  graphSizes: {
    "": 2,
    "urn:graph:public": 2,
    "urn:graph:private": 1,
  },
  search: [
    {
      name: "alice across graphs",
      request: { query: "alice", topK: 10 },
    },
    {
      name: "confidential hits the private graph only",
      request: { query: "confidential", topK: 10 },
    },
    {
      name: "public scoped to the public graph via QuadFilter",
      request: {
        query: "public",
        topK: 10,
        include: { graphs: ["urn:graph:public"] },
      },
    },
  ],
  sparql: [
    {
      name: "private-graph subjects",
      query: "SELECT ?s WHERE { GRAPH <urn:graph:private> { ?s ?p ?o } }",
      expected: {
        kind: "select",
        bindings: [{ s: { type: "uri", value: "urn:alice" } }],
      },
    },
    {
      name: "ask a public-graph fact",
      query: "ASK WHERE { GRAPH <urn:graph:public> { <urn:bob> ?p ?o } }",
      expected: { kind: "ask", boolean: true },
    },
    {
      name: "cross-graph join narrows to alice",
      query:
        "SELECT ?s WHERE { GRAPH <urn:graph:public> { ?s <urn:posted> ?o } . GRAPH <urn:graph:private> { ?s <urn:stores> ?x } }",
      expected: {
        kind: "select",
        bindings: [{ s: { type: "uri", value: "urn:alice" } }],
      },
    },
    {
      name: "total quad count across all graphs",
      query:
        "SELECT (COUNT(*) AS ?c) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }",
      expected: {
        kind: "select",
        bindings: [{
          c: { type: "literal", value: "5", datatype: XSD + "integer" },
        }],
      },
    },
  ],
};

/**
 * typedLiteralsWorld covers the literal type surface: plain (xsd:string),
 * language-tagged (en/es/ar incl. RTL unicode), and typed literals
 * (integer, double, date, boolean).
 */
export const typedLiteralsWorld: ParityFixture = {
  name: "typedLiteralsWorld",
  nquads: [
    '<urn:item1> <urn:label> "Widget" .',
    '<urn:item1> <urn:greeting> "Hello"@en .',
    '<urn:item1> <urn:greeting> "Hola"@es .',
    '<urn:item1> <urn:greeting> "\u0645\u0631\u062d\u0628\u0627"@ar .',
    '<urn:item1> <urn:count> "42"^^<' + XSD + "integer> .",
    '<urn:item1> <urn:ratio> "3.14"^^<' + XSD + "double> .",
    '<urn:item1> <urn:born> "2000-01-01"^^<' + XSD + "date> .",
    '<urn:item1> <urn:active> "true"^^<' + XSD + "boolean> .",
  ].join("\n"),
  totalQuads: 8,
  graphSizes: { "": 8 },
  search: [
    { name: "widget label", request: { query: "Widget", topK: 10 } },
    {
      name: "arabic greeting (unicode)",
      request: { query: "\u0645\u0631\u062d\u0628\u0627", topK: 10 },
    },
    { name: "english greeting", request: { query: "Hello", topK: 10 } },
  ],
  sparql: [
    {
      name: "lang-filtered greeting returns the arabic literal",
      query:
        'SELECT ?o WHERE { <urn:item1> <urn:greeting> ?o FILTER (LANG(?o) = "ar") }',
      expected: {
        kind: "select",
        bindings: [
          {
            o: {
              type: "literal",
              value: "\u0645\u0631\u062d\u0628\u0627",
              "xml:lang": "ar",
            },
          },
        ],
      },
    },
    {
      name: "typed integer literal round-trips its datatype",
      query: "SELECT ?o WHERE { <urn:item1> <urn:count> ?o }",
      expected: {
        kind: "select",
        bindings: [
          { o: { type: "literal", value: "42", datatype: XSD + "integer" } },
        ],
      },
    },
    {
      name: "boolean literal matches SPARQL true",
      query: "ASK WHERE { <urn:item1> <urn:active> true }",
      expected: { kind: "ask", boolean: true },
    },
  ],
};

/**
 * rdfStarWorld declares the RDF-star corpus category (RDF 1.2 quoted-triple
 * syntax). Under RDF 1.2 occurrence semantics, the quoted-triple subject
 * statement expands to a reification quad (an anonymous reifier with
 * rdf:reifies) plus the claim, so the world holds 3 quads. The SPARQL engine
 * models quoted triples, but the durable reference cannot store them yet
 * (the backend-neutral Term layer throws on Quad terms), so this fixture is
 * gated "declared": it runs and is reported, but does not fail the suite
 * until the reference lands RDF-star storage.
 */
export const rdfStarWorld: ParityFixture = {
  name: "rdfStarWorld",
  nquads: [
    '<< <urn:alice> <urn:likes> <urn:sailing> >> <urn:claims> "yes" .',
    '<urn:alice> <urn:notes> "alice keeps a journal" .',
  ].join("\n"),
  totalQuads: 3,
  graphSizes: { "": 3 },
  gate: "declared",
  sparql: [
    {
      name: "quoted-triple pattern matches the RDF-star fact",
      query:
        "SELECT ?o WHERE { << <urn:alice> <urn:likes> <urn:sailing> >> <urn:claims> ?o }",
      expected: {
        kind: "select",
        bindings: [{ o: { type: "literal", value: "yes" } }],
      },
    },
  ],
};

/**
 * chunkBoundaryWorld exercises the search chunker with a literal far longer
 * than the reference's default 1000-char chunk size, plus a short needle
 * literal. Both Sdks must produce identical chunk-derived search result ids.
 */
export const chunkBoundaryWorld: ParityFixture = {
  name: "chunkBoundaryWorld",
  nquads: [
    '<urn:long> <urn:body> "' +
    longParagraph() +
    '" .',
    '<urn:long> <urn:tag> "needle" .',
  ].join("\n"),
  totalQuads: 2,
  graphSizes: { "": 2 },
  search: [
    {
      name: "turquoise hits the long chunk",
      request: { query: "turquoise", topK: 10 },
    },
    { name: "needle short literal", request: { query: "needle", topK: 5 } },
  ],
};

/** emptyWorld verifies zero-quad behavior end to end. */
export const emptyWorld: ParityFixture = {
  name: "emptyWorld",
  nquads: "",
  totalQuads: 0,
  graphSizes: { "": 0 },
  search: [{ name: "empty search", request: { query: "anything", topK: 10 } }],
  sparql: [
    {
      name: "ask is false on the empty world",
      query: "ASK WHERE { ?s ?p ?o }",
      expected: { kind: "ask", boolean: false },
    },
  ],
};

/**
 * replaceModeCase exercises replace-mode import: the second import must fully
 * wipe the first (the reference's commit-patch replace-mode contract).
 */
export const replaceModeCase: ParityReplaceCase = {
  name: "replaceModeCase",
  first: [
    '<urn:a> <urn:p> "one" .',
    '<urn:b> <urn:p> "two" .',
  ].join("\n"),
  second: '<urn:c> <urn:p> "three" .',
  resultCount: 1,
};

/** parityCorpus is the full registry run by runParitySuite by default. */
export const parityCorpus: ParityCorpus = {
  fixtures: [
    multiGraphWorld,
    typedLiteralsWorld,
    rdfStarWorld,
    chunkBoundaryWorld,
    emptyWorld,
  ],
  replaceCases: [replaceModeCase],
};

/**
 * longParagraph returns a deterministic English paragraph of roughly 1,400
 * characters (well past the reference's default 1000-char chunk size) with
 * repeated "turquoise" tokens so the long chunk is searchable.
 */
function longParagraph(): string {
  const sentence =
    "The turquoise ribbon drifted over the harbor while a lone gull circled " +
    "the mast and the evening tide carried the fishing boats home one by one. ";
  const paragraph = sentence.repeat(14);
  return paragraph.slice(0, 1400);
}
