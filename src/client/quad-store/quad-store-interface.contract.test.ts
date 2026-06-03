import { assertEquals } from "@std/assert";
import { DataFactory, Store } from "n3";
import type { QuadStoreInterface } from "./quad-store-interface.ts";
import { RdfjsQuadStore } from "@/rdfjs/rdfjs-quad-store.ts";

const { namedNode, literal, quad } = DataFactory;

const fixtureQuad1 = quad(
  namedNode("http://example.org/s1"),
  namedNode("http://example.org/p1"),
  literal("value1"),
);
const fixtureQuad2 = quad(
  namedNode("http://example.org/s2"),
  namedNode("http://example.org/p2"),
  literal("value2"),
);

/**
 * ContractTestContext houses the QuadStore instance to run tests against
 * and an optional cleanup hook for resources like network clients or file locks.
 */
export interface ContractTestContext {
  /** The concrete QuadStore adapter instance. */
  store: QuadStoreInterface;

  /** Teardown hook executed after each contract test runs. */
  cleanup?: () => Promise<void> | void;
}

/**
 * ContractTestOptions configures a single adapter's integration into the harness.
 */
export interface ContractTestOptions {
  /** The descriptive name of the adapter (e.g. 'LibsqlQuadStore'). */
  label: string;

  /** Setup factory creating a fresh store and hook for isolation. */
  setup: () => Promise<ContractTestContext> | ContractTestContext;
}

export function registerQuadStoreContractTests(
  options: ContractTestOptions,
): void {
  const { label, setup } = options;

  Deno.test(`${label} - contract - merge mode retains prior quads`, async () => {
    const { store, cleanup } = await setup();
    try {
      await store.import({
        mode: "merge",
        source: { kind: "quads", quads: [fixtureQuad1] },
      });
      await store.import({
        mode: "merge",
        source: { kind: "quads", quads: [fixtureQuad2] },
      });

      const response = await store.export({ format: { kind: "quads" } });
      if (response.kind !== "quads") {
        throw new Error("Expected quads response");
      }
      assertEquals(response.quads.length, 2);
    } finally {
      if (cleanup) await cleanup();
    }
  });

  Deno.test(`${label} - contract - replace mode leaves only new quads`, async () => {
    const { store, cleanup } = await setup();
    try {
      await store.import({
        mode: "merge",
        source: { kind: "quads", quads: [fixtureQuad1] },
      });
      await store.import({
        mode: "replace",
        source: { kind: "quads", quads: [fixtureQuad2] },
      });

      const response = await store.export({ format: { kind: "quads" } });
      if (response.kind !== "quads") {
        throw new Error("Expected quads response");
      }
      assertEquals(response.quads.length, 1);
      assertEquals(response.quads[0].subject.value, fixtureQuad2.subject.value);
    } finally {
      if (cleanup) await cleanup();
    }
  });
}

registerQuadStoreContractTests({
  label: "RdfjsQuadStore",
  setup: () => ({
    store: new RdfjsQuadStore({ store: new Store() }),
  }),
});
