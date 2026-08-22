/**
 * The @worlds/sdk/testing subpath is the shared parity harness for the
 * durable-backend family (per the shared parity/benchmark suite definition,
 * wazootech/workspace#72). It is a thin driver over the existing WorldsSdk seam —
 * no new interfaces, no new runtime surface — consumed by backend repos as a
 * devDependency in their phase-4 parity suites.
 *
 * - `parity-fixtures.ts` — the shared fixture corpus (multi-graph worlds,
 *   typed literals, RDF-star [declared], chunk-boundary texts, empty world,
 *   replace-mode) as plain N-Quads data.
 * - `run-parity-suite.ts` — `runParitySuite`, comparing a candidate backend
 *   against a reference WorldsSdk (libsql) on the corpus.
 */
export * from "./parity-fixtures.ts";
export * from "./run-parity-suite.ts";
