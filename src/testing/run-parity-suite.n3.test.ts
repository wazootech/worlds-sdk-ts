import { assertEquals } from "@std/assert";
import { Store } from "n3";
import { Sdk } from "@/client/client.ts";
import { type Patch, Transaction } from "@/client/quad-store/mod.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@/rdfjs/mod.ts";
import { createMemorySdk } from "@/memory/mod.ts";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";
import { parityCorpus } from "./parity-fixtures.ts";
import { runParitySuite } from "./run-parity-suite.ts";

/**
 * Cross-store differential parity: the n3.Store topology (the original
 * self-test double, kept because two genuinely independent in-memory RDF/JS
 * implementations agreeing on the whole corpus is a strong signal the
 * harness discriminates backend behavior, not store implementation).
 *
 * Search ordering is compared set-wise (strictSearchOrder: false): for
 * scan-based keyword search the result order is scan order, which is a store
 * implementation detail — the parity contract that matters is that the same
 * worlds yield the same result sets on both stores.
 */
function createN3Sdk(): Sdk {
  const store = new Store();
  return new Sdk({
    quadStore: new RdfjsQuadStore({ store }),
    sparqlEngine: new WazooSparqlEngine({
      store,
      createTransaction: () => {
        return new Transaction({
          commit: (patch: Patch) => {
            for (const quad of patch.insertions) store.addQuad(quad);
            for (const quad of patch.deletions) store.removeQuad(quad);
            return Promise.resolve();
          },
        });
      },
    }),
    searchIndex: new RdfjsSearchIndex(store),
  });
}

Deno.test(
  "runParitySuite - engine MemoryStore and n3.Store agree on the full corpus",
  async () => {
    const report = await runParitySuite({
      reference: () => createMemorySdk(),
      candidate: () => createN3Sdk(),
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

    // The reference-gate fixtures must be clean on both stores — any
    // divergence there is a real parity break, not a declared-category note.
    const referenceGated = report.results.filter((r) =>
      r.name !== "rdfStarWorld"
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
