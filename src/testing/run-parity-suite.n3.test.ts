import { expect, test } from "bun:test";
import { Store } from "n3";
import { WorldsSdk } from "@/client/client.ts";
import { type Patch, Transaction } from "@/client/quad-store/mod.ts";
import { RdfjsQuadStore, RdfjsSearchIndex } from "@/rdfjs/mod.ts";
import { createMemoryWorldsSdk } from "@/memory/mod.ts";
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
function createN3WorldsSdk(): WorldsSdk {
  const store = new Store();
  return new WorldsSdk({
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

test(
  "runParitySuite - engine MemoryStore and n3.Store agree on the full corpus",
  async () => {
    const report = await runParitySuite({
      reference: () => createMemoryWorldsSdk(),
      candidate: () => createN3WorldsSdk(),
      strictSearchOrder: false,
    });

    expect(report.results.length).toStrictEqual(parityCorpus.fixtures.length + parityCorpus.replaceCases.length);
    // A failing parity suite reports every failed case, not just "false".
    expect(report.ok ? "ok" : report.results
      .map(
        (r) =>
          `${r.name}: ${r.failures.join("; ")}` +
          `${r.notes ? ` [notes: ${r.notes.join("; ")}]` : ""}`,
      )
      .join("\n")).toBe("ok");

    // The reference-gate fixtures must be clean on both stores — any
    // divergence there is a real parity break, not a declared-category note.
    const referenceGated = report.results.filter((r) =>
      r.name !== "rdfStarWorld"
    );
    for (const result of referenceGated) {
      expect(result.ok ? "ok" : `${result.name}: ${result.failures.join("; ")}`).toBe("ok");
      expect(result.notes).toStrictEqual(undefined);
    }
  },
);
