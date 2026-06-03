import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import * as path from "@std/path";
import { createLibsqlClient } from "@worlds/client/libsql";
import type { Quad } from "@rdfjs/types";
import {
  buildHexastorePerfFixtureChecksumInputs,
  computeHexastorePerfFixtureChecksum,
  readHexastorePerfFixtureManifest,
  resolveHexastorePerfDbCachePaths,
  validateCachedLibsqlHexastorePerfDatabase,
  writeHexastorePerfFixtureManifest,
} from "./perf-db-cache.ts";
import { generateSyntheticQuads } from "./synthetic-data.ts";

async function importCorpusIntoLibsqlHexastoreForTest(
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

Deno.test(
  "computeHexastorePerfFixtureChecksum - stable digest for identical inputs",
  async () => {
    const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
      1000,
      "libsqlStore",
    );
    const firstChecksum = await computeHexastorePerfFixtureChecksum(
      checksumInputs,
    );
    const secondChecksum = await computeHexastorePerfFixtureChecksum(
      checksumInputs,
    );
    assertEquals(firstChecksum, secondChecksum);
  },
);

Deno.test(
  "computeHexastorePerfFixtureChecksum - different corpus version changes digest",
  async () => {
    const baselineInputs = buildHexastorePerfFixtureChecksumInputs(
      1000,
      "libsqlStore",
    );
    const baselineChecksum = await computeHexastorePerfFixtureChecksum(
      baselineInputs,
    );
    const alteredInputs = {
      ...baselineInputs,
      syntheticCorpusVersion: baselineInputs.syntheticCorpusVersion + 1,
    };
    const alteredChecksum = await computeHexastorePerfFixtureChecksum(
      alteredInputs,
    );
    assertNotEquals(baselineChecksum, alteredChecksum);
  },
);

Deno.test(
  "resolveHexastorePerfDbCachePaths - names libsqlStore database and manifest files",
  () => {
    const cachePaths = resolveHexastorePerfDbCachePaths(10, "libsqlStore");
    assertEquals(cachePaths.databasePath.endsWith("libsqlStore-10.db"), true);
    assertEquals(cachePaths.manifestPath.endsWith("libsqlStore-10.json"), true);
    assertEquals(
      cachePaths.databaseFileUrl.includes("libsqlStore-10.db"),
      true,
    );
  },
);

Deno.test(
  "resolveHexastorePerfDbCachePaths - names denokvStore KV directory and manifest files",
  () => {
    const cachePaths = resolveHexastorePerfDbCachePaths(10, "denokvStore");
    assertEquals(
      cachePaths.kvDirectoryPath.endsWith("denokvStore-10"),
      true,
    );
    assertEquals(cachePaths.manifestPath.endsWith("denokvStore-10.json"), true);
  },
);

Deno.test(
  "validateCachedLibsqlHexastorePerfDatabase - accepts quads-only in-memory fixture",
  async () => {
    const databaseClient = createClient({ url: ":memory:" });
    try {
      await importCorpusIntoLibsqlHexastoreForTest(
        databaseClient,
        generateSyntheticQuads(10),
      );
      const expectedChecksum = await computeHexastorePerfFixtureChecksum(
        buildHexastorePerfFixtureChecksumInputs(10, "libsqlStore"),
      );
      const isValid = await validateCachedLibsqlHexastorePerfDatabase(
        databaseClient,
        { quadCount: 10, expectedChecksum },
      );
      assertEquals(isValid, true);
    } finally {
      databaseClient.close();
    }
  },
);

Deno.test(
  "writeHexastorePerfFixtureManifest - round-trips manifest JSON",
  async () => {
    const temporaryDirectory = await Deno.makeTempDir();
    const manifestPath = path.join(temporaryDirectory, "libsqlStore-10.json");
    try {
      const checksumInputs = buildHexastorePerfFixtureChecksumInputs(
        10,
        "libsqlStore",
      );
      const expectedChecksum = await computeHexastorePerfFixtureChecksum(
        checksumInputs,
      );
      const manifest = { ...checksumInputs, checksum: expectedChecksum };
      await writeHexastorePerfFixtureManifest(manifestPath, manifest);
      const parsedManifest = await readHexastorePerfFixtureManifest(
        manifestPath,
      );
      assertExists(parsedManifest);
      assertEquals(parsedManifest.checksum, expectedChecksum);
      assertEquals(parsedManifest.quadCount, 10);
    } finally {
      await Deno.remove(manifestPath);
      await Deno.remove(temporaryDirectory);
    }
  },
);
