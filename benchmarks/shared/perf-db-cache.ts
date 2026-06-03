import { type Client, createClient } from "@libsql/client";
import { encodeHex } from "@std/encoding/hex";
import * as path from "@std/path";
import { DenokvRdfjsStore } from "@worlds/client/denokv";
import { SYNTHETIC_CORPUS_VERSION } from "./synthetic-data.ts";

/**
 * BENCH_LIBSQL_SCHEMA_VERSION bumps when LibSQL quad index schema or perf fixture layout changes.
 */
export const BENCH_LIBSQL_SCHEMA_VERSION = 1;

/**
 * BENCH_DENOKV_HEXASTORE_SCHEMA_VERSION bumps when Denokv quad index layout relevant to perf fixtures changes.
 */
export const BENCH_DENOKV_HEXASTORE_SCHEMA_VERSION = 1;

/** HexastorePerfCacheBackend labels backends that support large on-disk perf fixture reuse. */
export type HexastorePerfCacheBackend = "libsqlStore" | "denokvStore";

/** DEFAULT_HEXASTORE_PERF_CACHE_DIR is the default on-disk cache root for large perf fixtures. */
const BENCHMARKS_ROOT = path.fromFileUrl(new URL("../..", import.meta.url));

/** DEFAULT_HEXASTORE_PERF_CACHE_DIR stores large database files under benchmarks/.cache. */
export const DEFAULT_HEXASTORE_PERF_CACHE_DIR = path.join(
  BENCHMARKS_ROOT,
  ".cache",
  "perf-large",
);

/** HexastorePerfFixtureChecksumInputsBase lists manifest fields shared across backends. */
interface HexastorePerfFixtureChecksumInputsBase {
  /** syntheticCorpusVersion tracks generateSyntheticQuads revisions. */
  syntheticCorpusVersion: number;
  /** quadCount is the synthetic corpus size for this fixture. */
  quadCount: number;
  /** searchIndexOnImport records the indexing mode used during import. */
  searchIndexOnImport: "disabled";
}

/**
 * LibsqlHexastorePerfFixtureChecksumInputs is the canonical checksum input for libsqlStore fixtures.
 */
export interface LibsqlHexastorePerfFixtureChecksumInputs
  extends HexastorePerfFixtureChecksumInputsBase {
  /** backend labels the quad index wiring. */
  backend: "libsqlStore";
  /** benchLibsqlSchemaVersion tracks LibSQL schema revisions relevant to perf fixtures. */
  benchLibsqlSchemaVersion: number;
}

/**
 * DenokvHexastorePerfFixtureChecksumInputs is the canonical checksum input for denokvStore fixtures.
 */
export interface DenokvHexastorePerfFixtureChecksumInputs
  extends HexastorePerfFixtureChecksumInputsBase {
  /** backend labels the quad index wiring. */
  backend: "denokvStore";
  /** benchDenokvHexastoreSchemaVersion tracks Denokv quad index revisions relevant to perf fixtures. */
  benchDenokvHexastoreSchemaVersion: number;
}

/**
 * HexastorePerfFixtureChecksumInputs lists manifest fields hashed for bench cache identity.
 */
export type HexastorePerfFixtureChecksumInputs =
  | LibsqlHexastorePerfFixtureChecksumInputs
  | DenokvHexastorePerfFixtureChecksumInputs;

/**
 * HexastorePerfFixtureManifest persists checksum inputs plus the computed digest on disk.
 */
export type HexastorePerfFixtureManifest =
  & HexastorePerfFixtureChecksumInputs
  & {
    /** checksum is the SHA-256 hex digest of canonical HexastorePerfFixtureChecksumInputs JSON. */
    checksum: string;
  };

/**
 * LibsqlHexastorePerfDbCachePaths locates the SQLite file and JSON sidecar for a cached libsql fixture.
 */
export interface LibsqlHexastorePerfDbCachePaths {
  /** backend labels the quad index wiring. */
  backend: "libsqlStore";
  /** databasePath is the absolute path to the LibSQL SQLite file. */
  databasePath: string;
  /** databaseFileUrl is the libsql client URL for databasePath. */
  databaseFileUrl: string;
  /** manifestPath is the absolute path to the JSON manifest sidecar. */
  manifestPath: string;
}

/**
 * DenokvHexastorePerfDbCachePaths locates the on-disk KV directory and JSON sidecar for a cached denokv fixture.
 */
export interface DenokvHexastorePerfDbCachePaths {
  /** backend labels the quad index wiring. */
  backend: "denokvStore";
  /** kvDirectoryPath is the absolute path passed to Deno.openKv for a file-backed database. */
  kvDirectoryPath: string;
  /** manifestPath is the absolute path to the JSON manifest sidecar. */
  manifestPath: string;
}

/**
 * HexastorePerfDbCachePaths locates on-disk storage and manifest paths for a cached perf fixture.
 */
export type HexastorePerfDbCachePaths =
  | LibsqlHexastorePerfDbCachePaths
  | DenokvHexastorePerfDbCachePaths;

/**
 * CachedHexastorePerfFixtureValidation holds expected row counts for a cache hit check.
 */
export interface CachedHexastorePerfFixtureValidation {
  /** quadCount is the expected number of quads in the fixture. */
  quadCount: number;
  /** expectedChecksum is the digest that must match the manifest sidecar. */
  expectedChecksum: string;
}

/**
 * isBenchReuseDbEnabled returns true when BENCH_REUSE_DB=1 enables on-disk perf fixture reuse.
 */
export function isBenchReuseDbEnabled(): boolean {
  return Deno.env.get("BENCH_REUSE_DB") === "1";
}

/**
 * isBenchHexastorePerfFullScanEnabled returns true when fullScan benches are registered (opt-in).
 */
export function isBenchHexastorePerfFullScanEnabled(): boolean {
  return Deno.env.get("BENCH_HEXASTORE_PERF_FULL_SCAN") === "1" ||
    Deno.env.get("BENCH_CROSSOVER_FULL_SCAN") === "1";
}

/**
 * resolveHexastorePerfDbCacheDirectory returns the cache root from BENCH_DB_CACHE_DIR or the default.
 */
export function resolveHexastorePerfDbCacheDirectory(): string {
  const overrideDirectory = Deno.env.get("BENCH_DB_CACHE_DIR");
  if (overrideDirectory && overrideDirectory.length > 0) {
    return path.resolve(overrideDirectory);
  }
  return DEFAULT_HEXASTORE_PERF_CACHE_DIR;
}

/**
 * resolveHexastorePerfDbCachePaths builds storage and manifest paths for a large libsqlStore scale.
 */
export function resolveHexastorePerfDbCachePaths(
  quadCount: number,
  backend: "libsqlStore",
): LibsqlHexastorePerfDbCachePaths;
/**
 * resolveHexastorePerfDbCachePaths builds storage and manifest paths for a large denokvStore scale.
 */
export function resolveHexastorePerfDbCachePaths(
  quadCount: number,
  backend: "denokvStore",
): DenokvHexastorePerfDbCachePaths;
export function resolveHexastorePerfDbCachePaths(
  quadCount: number,
  backend: HexastorePerfCacheBackend,
): HexastorePerfDbCachePaths {
  const cacheDirectory = resolveHexastorePerfDbCacheDirectory();
  const manifestPath = path.join(
    cacheDirectory,
    `${backend}-${quadCount}.json`,
  );

  if (backend === "libsqlStore") {
    const databasePath = path.join(
      cacheDirectory,
      `${backend}-${quadCount}.db`,
    );
    return {
      backend: "libsqlStore",
      databasePath,
      databaseFileUrl: path.toFileUrl(databasePath).href,
      manifestPath,
    };
  }

  const kvDirectoryPath = path.join(
    cacheDirectory,
    `${backend}-${quadCount}`,
  );
  return {
    backend: "denokvStore",
    kvDirectoryPath,
    manifestPath,
  };
}

/**
 * buildHexastorePerfFixtureChecksumInputs constructs canonical checksum inputs for a quads-only fixture.
 */
export function buildHexastorePerfFixtureChecksumInputs(
  quadCount: number,
  backend: HexastorePerfCacheBackend,
): HexastorePerfFixtureChecksumInputs {
  const sharedFields = {
    syntheticCorpusVersion: SYNTHETIC_CORPUS_VERSION,
    quadCount,
    searchIndexOnImport: "disabled" as const,
  };

  if (backend === "libsqlStore") {
    return {
      ...sharedFields,
      backend: "libsqlStore",
      benchLibsqlSchemaVersion: BENCH_LIBSQL_SCHEMA_VERSION,
    };
  }

  return {
    ...sharedFields,
    backend: "denokvStore",
    benchDenokvHexastoreSchemaVersion: BENCH_DENOKV_HEXASTORE_SCHEMA_VERSION,
  };
}

/**
 * computeHexastorePerfFixtureChecksum returns a SHA-256 hex digest of canonical fixture checksum inputs.
 */
export async function computeHexastorePerfFixtureChecksum(
  inputs: HexastorePerfFixtureChecksumInputs,
): Promise<string> {
  const canonicalJson = JSON.stringify(inputs);
  const encodedInputs = new TextEncoder().encode(canonicalJson);
  const digestBuffer = await crypto.subtle.digest("SHA-256", encodedInputs);
  return encodeHex(new Uint8Array(digestBuffer));
}

/**
 * readHexastorePerfFixtureManifest loads a manifest sidecar when present.
 */
export async function readHexastorePerfFixtureManifest(
  manifestPath: string,
): Promise<HexastorePerfFixtureManifest | undefined> {
  try {
    const manifestText = await Deno.readTextFile(manifestPath);
    return JSON.parse(manifestText) as HexastorePerfFixtureManifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * writeHexastorePerfFixtureManifest persists a manifest sidecar after a successful cache build.
 */
export async function writeHexastorePerfFixtureManifest(
  manifestPath: string,
  manifest: HexastorePerfFixtureManifest,
): Promise<void> {
  await Deno.writeTextFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/**
 * ensureHexastorePerfCacheDirectoryExists creates the cache directory when missing.
 */
export async function ensureHexastorePerfCacheDirectoryExists(
  cacheDirectory: string,
): Promise<void> {
  await Deno.mkdir(cacheDirectory, { recursive: true });
}

/**
 * removeStaleHexastorePerfCacheFiles deletes a partial or invalid storage and manifest pair.
 */
export async function removeStaleHexastorePerfCacheFiles(
  cachePaths: HexastorePerfDbCachePaths,
): Promise<void> {
  if (cachePaths.backend === "libsqlStore") {
    await Promise.all([
      Deno.remove(cachePaths.databasePath).catch(() => undefined),
      Deno.remove(cachePaths.manifestPath).catch(() => undefined),
    ]);
    return;
  }

  await Promise.all([
    Deno.remove(cachePaths.kvDirectoryPath, { recursive: true }).catch(() =>
      undefined
    ),
    Deno.remove(cachePaths.manifestPath).catch(() => undefined),
  ]);
}

/**
 * validateCachedLibsqlHexastorePerfDatabase checks quad/chunk counts for a quads-only cache hit.
 */
export async function validateCachedLibsqlHexastorePerfDatabase(
  databaseClient: Client,
  validation: CachedHexastorePerfFixtureValidation,
): Promise<boolean> {
  const quadCountResult = await databaseClient.execute(
    "SELECT COUNT(*) AS total FROM quads",
  );
  const chunkCountResult = await databaseClient.execute(
    "SELECT COUNT(*) AS total FROM chunks",
  );
  const storedQuadCount = Number(quadCountResult.rows[0]?.total ?? -1);
  const storedChunkCount = Number(chunkCountResult.rows[0]?.total ?? -1);
  return storedQuadCount === validation.quadCount &&
    storedChunkCount === 0;
}

/**
 * validateCachedDenokvHexastorePerfDatabase checks quad counts for a quads-only Denokv cache hit.
 */
export async function validateCachedDenokvHexastorePerfDatabase(
  kv: Deno.Kv,
  validation: CachedHexastorePerfFixtureValidation,
): Promise<boolean> {
  const rdfjsStore = new DenokvRdfjsStore({ kv });
  const storedQuadCount = await rdfjsStore.countQuads(null, null, null, null);
  return storedQuadCount === validation.quadCount;
}

/**
 * tryResolveHexastorePerfCacheHit validates manifest and storage state; logs cache miss reasons.
 */
export async function tryResolveHexastorePerfCacheHit(
  cachePaths: HexastorePerfDbCachePaths,
  expectedChecksum: string,
  quadCount: number,
): Promise<boolean> {
  const manifest = await readHexastorePerfFixtureManifest(
    cachePaths.manifestPath,
  );
  if (!manifest) {
    console.log(`cache miss (${cachePaths.manifestPath}: no manifest)`);
    return false;
  }
  if (manifest.checksum !== expectedChecksum) {
    console.log("cache miss (manifest checksum mismatch)");
    return false;
  }

  if (cachePaths.backend === "libsqlStore") {
    try {
      await Deno.stat(cachePaths.databasePath);
    } catch {
      console.log(`cache miss (${cachePaths.databasePath}: database missing)`);
      return false;
    }

    const databaseClient = createClient({ url: cachePaths.databaseFileUrl });

    try {
      const isValid = await validateCachedLibsqlHexastorePerfDatabase(
        databaseClient,
        {
          quadCount,
          expectedChecksum,
        },
      );
      if (!isValid) {
        console.log("cache miss (quad or chunk count mismatch)");
      }
      return isValid;
    } finally {
      databaseClient.close();
    }
  }

  try {
    await Deno.stat(cachePaths.kvDirectoryPath);
  } catch {
    console.log(
      `cache miss (${cachePaths.kvDirectoryPath}: KV directory missing)`,
    );
    return false;
  }

  const kv = await Deno.openKv(cachePaths.kvDirectoryPath);

  try {
    const isValid = await validateCachedDenokvHexastorePerfDatabase(kv, {
      quadCount,
      expectedChecksum,
    });
    if (!isValid) {
      console.log("cache miss (quad count mismatch)");
    }
    return isValid;
  } finally {
    kv.close();
  }
}
