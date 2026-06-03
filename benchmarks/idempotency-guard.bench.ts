import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { createLibsqlClient } from "@/libsql/mod.ts";
import { generateSyntheticQuads } from "./shared/synthetic-data.ts";

const { quad, namedNode, literal } = DataFactory;

const databaseClient = createClient({ url: ":memory:" });
const client = await createLibsqlClient({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

// Pre-allocate payloads for clean measurements
const payload100 = generateSyntheticQuads(100);

// For novel insert benchmark, we need a helper to generate fresh quads per run
let indexCounter = 1000;
function generateFreshPayload(count: number) {
  const freshQuads = [];
  for (let i = 0; i < count; i++) {
    indexCounter++;
    freshQuads.push(
      quad(
        namedNode(`urn:entity:fresh:${indexCounter}`),
        namedNode("urn:property:name"),
        literal(`Fresh payload text for unique entity number ${indexCounter}`),
      ),
    );
  }
  return freshQuads;
}

// Warm up/Populate baseline data
await client.import({
  source: { kind: "quads", quads: payload100 },
});

// -----------------------------------------------------------------------------
// IDEMPOTENCY GUARD BENCHMARKS
// -----------------------------------------------------------------------------

Deno.bench({
  name: "Idempotency: Novel Insert (New Quads Ingested)",
  group: "Idempotency Guard Performance",
  async fn(benchContext) {
    const freshPayload = generateFreshPayload(100);

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: freshPayload },
    });
    benchContext.end();
  },
});

Deno.bench({
  name: "Idempotency: Redundant Insert (Duplicate Quads Suppressed)",
  group: "Idempotency Guard Performance",
  async fn(benchContext) {
    benchContext.start();
    // Re-importing payload100 which already exists in the database
    await client.import({
      source: { kind: "quads", quads: payload100 },
    });
    benchContext.end();
  },
});
