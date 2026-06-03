import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { createLibsqlClient } from "@/libsql/mod.ts";

const { quad, namedNode, literal } = DataFactory;

const databaseClient = createClient({ url: ":memory:" });
const client = await createLibsqlClient({
  client: databaseClient,
  searchIndexOnImport: "disabled",
});

let indexCounter = 3000;
function generateBatchPayload(count: number) {
  const bulkQuads = [];
  for (let i = 0; i < count; i++) {
    indexCounter++;
    bulkQuads.push(
      quad(
        namedNode(`urn:entity:sync-batch:${indexCounter}`),
        namedNode("urn:property:name"),
        literal(`Batch payload text for unique entity number ${indexCounter}`),
      ),
    );
  }
  return bulkQuads;
}

// Measures the performance scaling of consolidated transactional batch imports.

Deno.bench({
  name: "Sync: Consolidated Batch Commit (10 Quads)",
  group: "Consolidated Batch Ingestion",
  async fn(benchContext) {
    const payload = generateBatchPayload(10);

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payload },
    });
    benchContext.end();
  },
});

Deno.bench({
  name: "Sync: Consolidated Batch Commit (100 Quads)",
  group: "Consolidated Batch Ingestion",
  async fn(benchContext) {
    const payload = generateBatchPayload(100);

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payload },
    });
    benchContext.end();
  },
});

Deno.bench({
  name: "Sync: Consolidated Batch Commit (1,000 Quads)",
  group: "Consolidated Batch Ingestion",
  async fn(benchContext) {
    const payload = generateBatchPayload(1000);

    benchContext.start();
    await client.import({
      source: { kind: "quads", quads: payload },
    });
    benchContext.end();
  },
});
