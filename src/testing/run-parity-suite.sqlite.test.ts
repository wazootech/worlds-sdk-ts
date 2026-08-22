import { assertEquals } from "@std/assert";
import { WorldsSdk } from "@/client/client.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@/rdfjs/mod.ts";
import { createMemoryWorldsSdk } from "@/memory/mod.ts";
import { SqliteStore } from "@worlds/sqlite";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { parityCorpus } from "./parity-fixtures.ts";
import { runParitySuite } from "./run-parity-suite.ts";

/**
 * Zero-dependency parity proof (wazootech/workspace#74): the harness runs the
 * full corpus with the in-memory reference (createMemoryWorldsSdk) against a real
 * backend store — @worlds/sqlite's durable SqliteStore, the store the future
 * createSqliteWorldsSdk is built on — with no libsql anywhere in the run.
 *
 * This is the pre-publish shape of worlds-sqlite's phase-4 parity suite
 * (workspace#64): once @worlds/sdk 0.4.0 with ./testing + ./memory publishes,
 * worlds-sqlite consumes `@worlds/sdk/testing` and `@worlds/sdk/memory` as
 * devDependencies and copies this exact file. Search ordering is compared
 * set-wise (strictSearchOrder: false): scan-based keyword search order is a
 * store implementation detail, not a parity contract.
 */
function createSqliteWorldsSdk(): WorldsSdk {
  const store = new SqliteStore({ path: ":memory:" });
  return new WorldsSdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({ store }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}

Deno.test(
  "runParitySuite - SqliteStore agrees with the in-memory reference on the full corpus",
  async () => {
    const report = await runParitySuite({
      reference: () => createMemoryWorldsSdk(),
      candidate: () => createSqliteWorldsSdk(),
      strictSearchOrder: false,
    });

    assertEquals(
      report.results.length,
      parityCorpus.fixtures.length + parityCorpus.replaceCases.length,
      "every corpus fixture and replace case runs on both stores",
    );
    assertEquals(
      report.ok,
      true,
      report.results
        .map(
          (r) =>
            `${r.name}: ${r.failures.join("; ")}` +
            `${r.notes ? ` [notes: ${r.notes.join("; ")}]` : ""}`,
        )
        .join("\n"),
    );

    // The reference-gated fixtures must be clean on both stores — any
    // divergence there is a real parity break, not a declared-category note.
    const referenceGated = report.results.filter(
      (r) => r.name !== "rdfStarWorld",
    );
    for (const result of referenceGated) {
      assertEquals(
        result.ok,
        true,
        `${result.name}: ${result.failures.join("; ")}`,
      );
      assertEquals(
        result.notes,
        undefined,
        `${result.name} must have no notes`,
      );
    }
  },
);
