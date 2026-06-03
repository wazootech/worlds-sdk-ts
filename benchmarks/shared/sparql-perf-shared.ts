import { createClient } from "@libsql/client";
import type { Quad } from "@rdfjs/types";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import type { ClientInterface } from "@worlds/client";
import { createDenokvClient } from "@worlds/client/denokv";
import { createLibsqlClient } from "@worlds/client/libsql";
import {
  buildHexastorePerfFixtureChecksumInputs,
  computeHexastorePerfFixtureChecksum,
  ensureHexastorePerfCacheDirectoryExists,
  isBenchHexastorePerfFullScanEnabled,
  removeStaleHexastorePerfCacheFiles,
  resolveHexastorePerfDbCacheDirectory,
  resolveHexastorePerfDbCachePaths,
  tryResolveHexastorePerfCacheHit,
  writeHexastorePerfFixtureManifest,
} from "./perf-db-cache.ts";
import { generateSyntheticQuads } from "./synthetic-data.ts";

/** selectiveSubjectIri is the grounded subject for subject-bound SPARQL benchmarks. */
export const selectiveSubjectIri = "urn:entity:0";

/** selectiveSparqlQuery exercises a subject-bound BGP (quad index-friendly). */
export const selectiveSparqlQuery =
  `SELECT ?p ?o WHERE { <${selectiveSubjectIri}> ?p ?o }`;

/** fullScanSparqlQuery exercises an unbound triple pattern with a small result cap. */
export const fullScanSparqlQuery =
  "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100";

const sharedQueryEngine = new QueryEngine();

/** SparqlQueryShape labels the SPARQL quad index perf query patterns. */
export type SparqlQueryShape = "selective" | "fullScan";

/** standardHexastorePerfQueryShapes is the default dev iteration set (subject-bound only). */
export const standardHexastorePerfQueryShapes = [
  "selective",
] as const satisfies readonly SparqlQueryShape[];

/** allHexastorePerfQueryShapes includes the unbound dev-scan shape (opt-in via BENCH_HEXASTORE_PERF_FULL_SCAN=1). */
export const allHexastorePerfQueryShapes = [
  "selective",
  "fullScan",
] as const satisfies readonly SparqlQueryShape[];

/**
 * resolveHexastorePerfQueryShapes returns query shapes for quad index perf bench registration.
 */
export function resolveHexastorePerfQueryShapes(): readonly SparqlQueryShape[] {
  return isBenchHexastorePerfFullScanEnabled()
    ? allHexastorePerfQueryShapes
    : standardHexastorePerfQueryShapes;
}

/** SparqlBackend labels the quad index wiring under test. */
export type SparqlBackend = "libsqlStore" | "denokvStore";

/** libsqlHexastorePerfBackends targets the production LibsqlRdfjsStore quad index path. */
export const libsqlHexastorePerfBackends = [
  "libsqlStore",
] as const satisfies readonly SparqlBackend[];

/** denokvHexastorePerfBackends targets the Deno KV quad index RDF/JS store path. */
export const denokvHexastorePerfBackends = [
  "denokvStore",
] as const satisfies readonly SparqlBackend[];

/** PreloadedSparqlFixture holds a warmed Client and its storage handle. */
export interface PreloadedSparqlFixture {
  /** client executes SPARQL against the preloaded corpus. */
  client: ClientInterface;
  /** databaseClient is set for libsqlStore fixtures. */
  databaseClient?: ReturnType<typeof createClient>;
  /** kv is set for denokvStore fixtures. */
  kv?: Deno.Kv;
}

/**
 * PreloadSparqlHexastorePerfOptions configures quad index perf module preload behavior.
 */
export interface PreloadSparqlHexastorePerfOptions {
  /** reuseFileCache enables on-disk fixtures for libsqlStore and denokvStore when BENCH_REUSE_DB=1. */
  reuseFileCache?: boolean;
}

/**
 * LibsqlHexastoreFixtureResult reports whether a libsqlStore fixture used the file cache.
 */
interface LibsqlHexastoreFixtureResult {
  /** fixture is the warmed SPARQL engine and database handle. */
  fixture: PreloadedSparqlFixture;
  /** cacheHit is true when an on-disk database was reused without re-import. */
  cacheHit: boolean;
}

/**
 * sparqlEngineCacheKey builds a stable map key for preloaded quad index perf fixtures.
 */
export function sparqlEngineCacheKey(
  backend: SparqlBackend,
  quadCount: number,
): string {
  return `${backend}:${quadCount}`;
}

/**
 * sparqlQueryForShape returns the SPARQL string for a quad index perf query shape.
 */
export function sparqlQueryForShape(queryShape: SparqlQueryShape): string {
  return queryShape === "selective"
    ? selectiveSparqlQuery
    : fullScanSparqlQuery;
}

/**
 * importCorpusIntoLibsqlHexastore persists quads into LibSQL without timing SPARQL execute.
 */
async function importCorpusIntoLibsqlHexastore(
  databaseClient: ReturnType<typeof createClient>,
  corpusQuads: Quad[],
): Promise<void> {
  const worldsClient = await createLibsqlClient({
    client: databaseClient,
    searchIndexOnImport: "disabled",
  });
  await worldsClient.import({
    source: { kind: "quads", quads: corpusQuads },
  });
}

/**
 * openLibsqlHexastoreSparqlEngine wires Comunica over an existing LibsqlRdfjsStore database.
 */
async function openLibsqlHexastoreSparqlEngine(
  databaseClient: ReturnType<typeof createClient>,
): Promise<PreloadedSparqlFixture> {
  const worldsClient = await createLibsqlClient({
    client: databaseClient,
    searchIndexOnImport: "disabled",
    queryEngine: sharedQueryEngine,
  });
  return { databaseClient, client: worldsClient };
}

/**
 * createLibsqlHexastoreSparqlEngine wires Comunica over LibsqlRdfjsStore (no N3 hydration).
 */
async function createLibsqlHexastoreSparqlEngine(
  corpusQuads: Quad[],
  options?: { reuseFileCache?: boolean },
): Promise<LibsqlHexastoreFixtureResult> {
  if (!options?.reuseFileCache) {
    const databaseClient = createClient({ url: ":memory:" });
    await importCorpusIntoLibsqlHexastore(databaseClient, corpusQuads);
    const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
    return { fixture, cacheHit: false };
  }

  const quadCount = corpusQuads.length;
  const cachePaths = resolveHexastorePerfDbCachePaths(quadCount, "libsqlStore");
  const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
    quadCount,
    "libsqlStore",
  );
  const expectedChecksum = await computeHexastorePerfFixtureChecksum(
    checksumInputs,
  );

  const cacheHit = await tryResolveHexastorePerfCacheHit(
    cachePaths,
    expectedChecksum,
    quadCount,
  );

  if (cacheHit) {
    const databaseClient = createClient({ url: cachePaths.databaseFileUrl });
    const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
    return { fixture, cacheHit: true };
  }

  await ensureHexastorePerfCacheDirectoryExists(
    resolveHexastorePerfDbCacheDirectory(),
  );
  await removeStaleHexastorePerfCacheFiles(cachePaths);

  const databaseClient = createClient({ url: cachePaths.databaseFileUrl });
  await importCorpusIntoLibsqlHexastore(databaseClient, corpusQuads);

  const manifest = {
    ...checksumInputs,
    checksum: expectedChecksum,
  };
  await writeHexastorePerfFixtureManifest(cachePaths.manifestPath, manifest);

  const fixture = await openLibsqlHexastoreSparqlEngine(databaseClient);
  return { fixture, cacheHit: false };
}

/**
 * importCorpusIntoDenokvHexastore persists quads into Deno KV without timing SPARQL execute.
 */
async function importCorpusIntoDenokvHexastore(
  kv: Deno.Kv,
  corpusQuads: Quad[],
): Promise<void> {
  const worldsClient = createDenokvClient({ kv });
  await worldsClient.import({
    source: { kind: "quads", quads: corpusQuads },
  });
}

/**
 * openDenokvHexastoreSparqlEngine wires Comunica over an existing Deno KV corpus.
 */
function openDenokvHexastoreSparqlEngine(kv: Deno.Kv): PreloadedSparqlFixture {
  const worldsClient = createDenokvClient({
    kv,
    queryEngine: sharedQueryEngine,
  });
  return { kv, client: worldsClient };
}

/**
 * createDenokvHexastoreSparqlEngine wires Comunica over DenokvRdfjsStore (memory or file-backed KV).
 */
async function createDenokvHexastoreSparqlEngine(
  corpusQuads: Quad[],
  options?: { reuseFileCache?: boolean },
): Promise<{ fixture: PreloadedSparqlFixture; cacheHit: boolean }> {
  if (!options?.reuseFileCache) {
    const kv = await Deno.openKv(":memory:");
    await importCorpusIntoDenokvHexastore(kv, corpusQuads);
    return { fixture: openDenokvHexastoreSparqlEngine(kv), cacheHit: false };
  }

  const quadCount = corpusQuads.length;
  const cachePaths = resolveHexastorePerfDbCachePaths(quadCount, "denokvStore");
  const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
    quadCount,
    "denokvStore",
  );
  const expectedChecksum = await computeHexastorePerfFixtureChecksum(
    checksumInputs,
  );

  const cacheHit = await tryResolveHexastorePerfCacheHit(
    cachePaths,
    expectedChecksum,
    quadCount,
  );

  if (cacheHit) {
    const kv = await Deno.openKv(cachePaths.kvDirectoryPath);
    return { fixture: openDenokvHexastoreSparqlEngine(kv), cacheHit: true };
  }

  await ensureHexastorePerfCacheDirectoryExists(
    resolveHexastorePerfDbCacheDirectory(),
  );
  await removeStaleHexastorePerfCacheFiles(cachePaths);

  const kv = await Deno.openKv(cachePaths.kvDirectoryPath);
  await importCorpusIntoDenokvHexastore(kv, corpusQuads);

  const manifest = {
    ...checksumInputs,
    checksum: expectedChecksum,
  };
  await writeHexastorePerfFixtureManifest(cachePaths.manifestPath, manifest);

  return { fixture: openDenokvHexastoreSparqlEngine(kv), cacheHit: false };
}

async function createSparqlEngineForBackend(
  backend: SparqlBackend,
  corpusQuads: Quad[],
  preloadOptions?: PreloadSparqlHexastorePerfOptions,
): Promise<{ fixture: PreloadedSparqlFixture; cacheHit: boolean }> {
  if (backend === "libsqlStore") {
    const { fixture, cacheHit } = await createLibsqlHexastoreSparqlEngine(
      corpusQuads,
      { reuseFileCache: preloadOptions?.reuseFileCache },
    );
    return { fixture, cacheHit };
  }

  const { fixture, cacheHit } = await createDenokvHexastoreSparqlEngine(
    corpusQuads,
    { reuseFileCache: preloadOptions?.reuseFileCache },
  );
  return { fixture, cacheHit };
}

/**
 * preloadSparqlHexastorePerfFixtures builds corpus+engine fixtures at module load.
 * Generates synthetic quads once per scale and reuses the array across backends.
 */
export async function preloadSparqlHexastorePerfFixtures(
  perfScales: readonly number[],
  logPrefix: string,
  perfBackends: readonly SparqlBackend[],
  preloadOptions?: PreloadSparqlHexastorePerfOptions,
): Promise<Map<string, PreloadedSparqlFixture>> {
  const preloadedSparqlEngines = new Map<string, PreloadedSparqlFixture>();

  console.log(
    `Pre-populating SPARQL quad index perf engines (${logPrefix})...`,
  );

  for (const quadCount of perfScales) {
    const corpusGenerationLabel = `${logPrefix} generate ${quadCount} quads`;
    console.time(corpusGenerationLabel);
    const corpusQuads = generateSyntheticQuads(quadCount);
    console.timeEnd(corpusGenerationLabel);

    for (const backend of perfBackends) {
      const preloadLabel = `${logPrefix} ${backend} ${quadCount}`;
      console.time(preloadLabel);
      const { fixture, cacheHit } = await createSparqlEngineForBackend(
        backend,
        corpusQuads,
        preloadOptions,
      );
      console.timeEnd(preloadLabel);
      if (cacheHit) {
        console.log(`${preloadLabel} (cache hit)`);
      } else if (preloadOptions?.reuseFileCache) {
        console.log(`${preloadLabel} (imported to file cache)`);
      }
      preloadedSparqlEngines.set(
        sparqlEngineCacheKey(backend, quadCount),
        fixture,
      );
    }
  }

  console.log(`SPARQL quad index perf engines ready (${logPrefix}).`);
  return preloadedSparqlEngines;
}

/**
 * registerSparqlHexastorePerfUnloadCleanup closes database handles when the bench module unloads.
 */
export function registerSparqlHexastorePerfUnloadCleanup(
  preloadedSparqlEngines: Map<string, PreloadedSparqlFixture>,
): void {
  globalThis.addEventListener("unload", () => {
    for (const fixture of preloadedSparqlEngines.values()) {
      fixture.databaseClient?.close();
      fixture.kv?.close();
    }
  });
}

/**
 * registerSparqlHexastorePerfBenchmarks registers execute-only quad index perf Deno.bench entries.
 */
export function registerSparqlHexastorePerfBenchmarks(
  perfScales: readonly number[],
  preloadedSparqlEngines: Map<string, PreloadedSparqlFixture>,
  perfBackends: readonly SparqlBackend[],
  queryShapes: readonly SparqlQueryShape[] = resolveHexastorePerfQueryShapes(),
): void {
  for (const quadCount of perfScales) {
    for (const queryShape of queryShapes) {
      for (const backend of perfBackends) {
        const query = sparqlQueryForShape(queryShape);
        const cacheKey = sparqlEngineCacheKey(backend, quadCount);
        Deno.bench({
          name:
            `SPARQL Hexastore Perf: ${quadCount} quads | ${queryShape} | ${backend}`,
          group: `SPARQL Hexastore Perf (${quadCount})`,
          async fn(benchContext) {
            const fixture = preloadedSparqlEngines.get(cacheKey);
            if (!fixture) {
              throw new Error(`Missing preloaded SPARQL fixture: ${cacheKey}`);
            }

            benchContext.start();
            await fixture.client.sparql({ query });
            benchContext.end();
          },
        });
      }
    }
  }
}
