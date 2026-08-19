/**
 * The @worlds/sdk/memory subpath exports the portable in-memory Sdk — the
 * durable-backend family's shared parity reference (wazootech/workspace#74).
 * createMemorySdk wires the engine's MemoryStore into the standard Sdk facade
 * (RdfjsQuadStore + RdfjsSearchIndex + WazooSparqlEngine over one shared
 * store), so the @worlds/sdk/testing harness and every backend's phase-4
 * parity suite can run against a zero-dependency in-memory reference.
 */
export * from "./create-memory-sdk.ts";
