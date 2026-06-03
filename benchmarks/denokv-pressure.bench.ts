import type { ClientInterface } from "@worlds/client";
import { createDenokvClient } from "@worlds/client/denokv";
import { generateSyntheticQuads } from "./shared/synthetic-data.ts";

// Pre-allocated payloads for strict repeatable boundaries
const payloadSmall = generateSyntheticQuads(10);
const payloadMedium = generateSyntheticQuads(100);
const payloadLarge = generateSyntheticQuads(1000);

/** writeBenchIterations stabilizes write-pressure timings across GC between cold KV setups. */
const writeBenchWarmup = 5;
const writeBenchIterations = 50;

/**
 * setupIsolatedClient establishes an ephemeral in-memory Deno.Kv and returns a client.
 */
async function setupIsolatedClient(): Promise<{
  client: ClientInterface;
  kv: Deno.Kv;
}> {
  const kv = await Deno.openKv(":memory:");
  const client = createDenokvClient({ kv });
  return { client, kv };
}

/**
 * createPreloadedClient persists a specified number of quads prior to timing trials.
 */
async function createPreloadedClient(count: number): Promise<{
  client: ClientInterface;
  kv: Deno.Kv;
}> {
  const { client, kv } = await setupIsolatedClient();
  await client.import({
    source: { kind: "quads", quads: generateSyntheticQuads(count) },
  });
  return { client, kv };
}

console.log("Pre-populating Deno Kv benchmark datasets...");

const exportCorpus100 = await createPreloadedClient(100);
const exportCorpus1000 = await createPreloadedClient(1000);
const exportCorpus5000 = await createPreloadedClient(5000);
const searchCorpus = await createPreloadedClient(2000);

console.log("Deno Kv benchmark datasets ready.");

globalThis.addEventListener("unload", () => {
  exportCorpus100.kv.close();
  exportCorpus1000.kv.close();
  exportCorpus5000.kv.close();
  searchCorpus.kv.close();
});

// -----------------------------------------------------------------------------
// BENCHMARK GROUP 1: Write Pressure (Deno Kv Batched Commits)
// Tests incremental batched ingestion limits for Deno Kv adapters.
// -----------------------------------------------------------------------------

Deno.bench({
  name: "Write Pressure: Import 10 Quads (Deno Kv :memory:)",
  group: "Write Pressure",
  warmup: writeBenchWarmup,
  n: writeBenchIterations,
  async fn(benchContext) {
    const { client, kv } = await setupIsolatedClient();

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payloadSmall },
    });
    benchContext.end();

    kv.close();
  },
});

Deno.bench({
  name: "Write Pressure: Import 100 Quads (Deno Kv :memory:)",
  group: "Write Pressure",
  warmup: writeBenchWarmup,
  n: writeBenchIterations,
  async fn(benchContext) {
    const { client, kv } = await setupIsolatedClient();

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payloadMedium },
    });
    benchContext.end();

    kv.close();
  },
});

Deno.bench({
  name: "Write Pressure: Import 1000 Quads (Deno Kv :memory:)",
  group: "Write Pressure",
  warmup: writeBenchWarmup,
  n: writeBenchIterations,
  async fn(benchContext) {
    const { client, kv } = await setupIsolatedClient();

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payloadLarge },
    });
    benchContext.end();

    kv.close();
  },
});

// -----------------------------------------------------------------------------
// BENCHMARK GROUP 2: Full graph export (durable read)
// Measures client.export() over the quad index — not N3 hydration.
// -----------------------------------------------------------------------------

Deno.bench({
  name: "Deno Kv FullGraphExport: 100 Quads from DB",
  group: "FullGraphExport",
  async fn(benchContext) {
    benchContext.start();
    await exportCorpus100.client.export({ format: { kind: "quads" } });
    benchContext.end();
  },
});

Deno.bench({
  name: "Deno Kv FullGraphExport: 1,000 Quads from DB",
  group: "FullGraphExport",
  async fn(benchContext) {
    benchContext.start();
    await exportCorpus1000.client.export({ format: { kind: "quads" } });
    benchContext.end();
  },
});

Deno.bench({
  name: "Deno Kv FullGraphExport: 5,000 Quads from DB",
  group: "FullGraphExport",
  async fn(benchContext) {
    benchContext.start();
    await exportCorpus5000.client.export({ format: { kind: "quads" } });
    benchContext.end();
  },
});

// -----------------------------------------------------------------------------
// BENCHMARK GROUP 3: DenokvSearchIndex full KV scan (not SPARQL hydration)
// client.search() calls DenokvSearchIndex.search(), which lists every quad under
// the KV prefix, deserializes each entry, and runs a naive includes() match.
// There is no N3 hydration and no early exit — hit and miss both scan the corpus.
// Preload is 2,000 quads; only the search call is timed.
// -----------------------------------------------------------------------------

Deno.bench({
  name: "Search: hit after full 2k KV scan (SYNT-1500)",
  group: "Search Speed",
  async fn(benchContext) {
    const targetKeyword = "SYNT-1500";

    benchContext.start();
    const response = await searchCorpus.client.search({
      query: targetKeyword,
    });
    benchContext.end();

    if (!response.results || response.results.length === 0) {
      throw new Error("Search expected a result match.");
    }
  },
});

Deno.bench({
  name: "Search: miss after full 2k KV scan (no matches)",
  group: "Search Speed",
  async fn(benchContext) {
    const nonExistentWord =
      "nonexistentwordthatcharacteristicallymisseseverything";

    benchContext.start();
    await searchCorpus.client.search({ query: nonExistentWord });
    benchContext.end();
  },
});
