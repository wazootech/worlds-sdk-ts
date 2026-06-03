import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import {
  LibsqlQuadStore,
  type LibsqlQuadStoreOptions,
} from "./quad-store/mod.ts";
import { LibsqlRdfjsStore } from "./rdfjs-store/mod.ts";
import type { Patch, TransactionContext } from "@/client/quad-store/mod.ts";

import { FakeEmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import {
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";
import { buildChunkFtsValue } from "@/libsql/search-index/search-chunk-fts.ts";

const { quad, namedNode, literal } = DataFactory;

/** Compat helper wrapping LibsqlQuadStore for testing. */
function createLibsqlPersistHooks(
  options: Omit<LibsqlQuadStoreOptions, "store">,
) {
  const store = new LibsqlRdfjsStore({
    client: options.client,
    matchPageSize: options.matchPageSize,
  });
  const quadStore = new LibsqlQuadStore({
    ...options,
    store,
  });
  return {
    commit: async (patch: Patch, context?: TransactionContext) => {
      const tx = quadStore.createTransaction();
      if (patch.insertions) {
        tx.addQuads(patch.insertions);
      }
      if (patch.deletions) {
        tx.removeQuads(patch.deletions);
      }
      await tx.commit(context);
    },
  };
}

Deno.test(
  "createLibsqlPersistHooks - bulk quad INSERT persists expected quads row count",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const bulkQuadCount = 120;
    const bulkQuads = Array.from({ length: bulkQuadCount }, (_, index) =>
      quad(
        namedNode(`urn:subject:${index}`),
        namedNode("urn:predicate"),
        literal(`bulk insert ${index}`),
      ));

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        labelPredicates: [],
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled",
    });

    await persistHooks.commit({ insertions: bulkQuads, deletions: [] });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), bulkQuadCount);
  },
);

Deno.test("createLibsqlPersistHooks - isolated writes and removals commit correctly to BOTH chunks and quads", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const persistHooks = createLibsqlPersistHooks({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchIndexProjector: new LibsqlSearchIndexProjector({
      client,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      labelPredicates: [],
      embeddingService: new FakeEmbeddingService(),
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("Content for synchronization tests"),
  );

  // 1. Commit insertion
  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  // 2. Verify both Tables updated
  let chunkRows = await client.execute("SELECT COUNT(*) as total FROM chunks");
  assertEquals(
    chunkRows.rows[0].total,
    1,
    "Expected one chunk written to index",
  );

  let quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(
    quadRows.rows[0].total,
    1,
    "Expected exact master quad record replicated",
  );

  // 3. Execute deletion
  await persistHooks.commit({
    insertions: [],
    deletions: [testQuad],
  });

  // 4. Verify holistic cleared state
  chunkRows = await client.execute("SELECT COUNT(*) as total FROM chunks");
  assertEquals(chunkRows.rows[0].total, 0, "Index cleanup failed");

  quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(quadRows.rows[0].total, 0, "Master quad cleanup failed");
});

Deno.test("createLibsqlPersistHooks - supports synchronization when embeddingService is omitted (vector column left null)", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const persistHooks = createLibsqlPersistHooks({
    client,
    // embeddingService is omitted intentionally
    searchIndexProjector: new LibsqlSearchIndexProjector({
      client,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      labelPredicates: [],
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("urn:subject"),
    namedNode("urn:predicate"),
    literal("Vectorless searchable text node"),
  );

  // Commit insertion
  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  // Verify that the chunk table has the row but with vector null
  const chunkRows = await client.execute("SELECT value, vector FROM chunks");
  assertEquals(
    chunkRows.rows.length,
    1,
    "Expected one chunk written to standard FTS index",
  );
  assertEquals(chunkRows.rows[0].value, "Vectorless searchable text node");
  assertEquals(
    chunkRows.rows[0].vector,
    null,
    "The vector data should remain null due to omitted adapter",
  );

  // Confirm parent quad still inserted
  const quadRows = await client.execute("SELECT COUNT(*) as total FROM quads");
  assertEquals(quadRows.rows[0].total, 1);
});

Deno.test("createLibsqlPersistHooks - stores literal value and discovery fts_value", async () => {
  const client = createClient({ url: ":memory:" });
  await setupLibsqlSchemaForTest(client);

  const persistHooks = createLibsqlPersistHooks({
    client,
    embeddingService: new FakeEmbeddingService(),
    searchIndexProjector: new LibsqlSearchIndexProjector({
      client,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      labelPredicates: [],
      embeddingService: new FakeEmbeddingService(),
    }),
    searchQueryBuilder: testLibsqlSearchQueryBuilder,
  });

  const testQuad = quad(
    namedNode("http://example.org/Aurelia"),
    namedNode("http://example.org/hasCapital"),
    literal("Lume"),
  );

  await persistHooks.commit({
    insertions: [testQuad],
    deletions: [],
  });

  const chunkRows = await client.execute(
    "SELECT value, fts_value FROM chunks",
  );
  assertEquals(chunkRows.rows.length, 1);
  assertEquals(chunkRows.rows[0].value, "Lume");
  assertEquals(
    chunkRows.rows[0].fts_value,
    buildChunkFtsValue({
      quad_id: "unused",
      subject: "http://example.org/Aurelia",
      predicate: "http://example.org/hasCapital",
      graph: "",
      value: "Lume",
    }, { labelLiteralsForSubject: [] }),
  );
});

Deno.test(
  "createLibsqlPersistHooks - bulk insertions beyond SQLITE_MAX_VARIABLE_NUMBER do not fail",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const bulkQuadCount = 2_500;
    const bulkQuads = Array.from({ length: bulkQuadCount }, (_, index) =>
      quad(
        namedNode(`urn:bulk:entity:${index}`),
        namedNode("urn:bulk:predicate"),
        literal(`bulk literal ${index}`),
      ));

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        labelPredicates: [],
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled", // Skip search chunk building so tests are fast
    });

    await persistHooks.commit({
      insertions: bulkQuads,
      deletions: [],
    });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), bulkQuadCount);
  },
);

Deno.test(
  "createLibsqlPersistHooks - large bulk insertions flush staged statements without stack overflow",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const largeBulkQuadCount = 50_000;
    const largeBulkQuads = Array.from(
      { length: largeBulkQuadCount },
      (_, index) =>
        quad(
          namedNode(`urn:large-bulk:entity:${index}`),
          namedNode("urn:large-bulk:predicate"),
          literal(`large bulk literal ${index}`),
        ),
    );

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        labelPredicates: [],
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled", // Skip search chunk building for pure bulk quad sync test
    });

    await persistHooks.commit({
      insertions: largeBulkQuads,
      deletions: [],
    });

    const quadRows = await client.execute(
      "SELECT COUNT(*) as total FROM quads",
    );
    assertEquals(Number(quadRows.rows[0].total), largeBulkQuadCount);
  },
);

Deno.test(
  "createLibsqlPersistHooks - deferred mode auto-rebuilds at the end of import",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const options = {
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        labelPredicates: [],
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "deferred" as const,
    };

    const persistHooks = createLibsqlPersistHooks(options);

    await persistHooks.commit({
      insertions: [
        quad(
          namedNode("urn:defer:entity:0"),
          namedNode("urn:defer:predicate"),
          literal("defer search index projection"),
        ),
      ],
      deletions: [],
    }, { importMode: "merge" }); // searchIndexOnImport: deferred automatically rebuilds at the end of import

    const chunkRows = await client.execute(
      "SELECT COUNT(*) as total FROM chunks",
    );
    assertEquals(Number(chunkRows.rows[0].total), 1);
  },
);

Deno.test(
  "createLibsqlPersistHooks - importMode replace wipes prior quads before insert",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        labelPredicates: [],
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      searchIndexOnImport: "disabled",
    });

    const priorQuad = quad(
      namedNode("urn:replace:prior"),
      namedNode("urn:predicate"),
      literal("prior"),
    );
    const replacementQuad = quad(
      namedNode("urn:replace:new"),
      namedNode("urn:predicate"),
      literal("new"),
    );

    await persistHooks.commit(
      { insertions: [priorQuad], deletions: [] },
    );

    await persistHooks.commit(
      { insertions: [replacementQuad], deletions: [] },
      { importMode: "replace" },
    );

    const quadRows = await client.execute(
      "SELECT s FROM quads ORDER BY s ASC",
    );
    assertEquals(quadRows.rows.length, 1);
    assertEquals(String(quadRows.rows[0].s), "urn:replace:new");
  },
);
