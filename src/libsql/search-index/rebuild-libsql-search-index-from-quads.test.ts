import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@libsql/client";
import { DataFactory } from "n3";
import { FakeEmbeddingService } from "@/client/search-index/embedding-service/mod.ts";
import { LibsqlSearchIndexProjector } from "@/libsql/search-index/libsql-search-index-projector.ts";
import {
  LibsqlQuadStore,
  type LibsqlQuadStoreOptions,
} from "@/libsql/quad-store/mod.ts";
import { LibsqlRdfjsStore } from "@/libsql/rdfjs-store/mod.ts";
import type { Patch, TransactionContext } from "@/client/quad-store/mod.ts";
import {
  setupLibsqlSchemaForTest,
  sharedTextSplitter,
  testLibsqlSchemaBuilder,
  testLibsqlSearchQueryBuilder,
} from "@/libsql/libsql-test-fixtures.ts";

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
import { LibsqlSearchIndex } from "./libsql-search-index.ts";
import { rebuildLibsqlSearchIndexFromQuads } from "./rebuild-libsql-search-index-from-quads.ts";
import { resolveLabelPredicates } from "./search-chunk-fts.ts";

const { quad, namedNode, literal } = DataFactory;

const AURELIA = "http://example.org/Aurelia";
const HAS_CAPITAL = "http://example.org/hasCapital";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const CUSTOM_LABEL = "http://example.org/customLabel";

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - discovers subject via fts_value while value stays literal",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad],
      deletions: [],
    });

    const chunkRows = await client.execute(
      "SELECT value, fts_value FROM chunks",
    );
    assertEquals(chunkRows.rows[0].value, "Lume");
    assertEquals(
      String(chunkRows.rows[0].fts_value).includes("Aurelia"),
      true,
    );

    const searchIndex = new LibsqlSearchIndex({
      client,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const discovery = await searchIndex.search({ query: "Aurelia" });
    assertEquals(discovery.results?.length, 1);
    assertEquals(discovery.results?.[0].subject, AURELIA);
    assertEquals(discovery.results?.[0].text, "Lume");
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - label literals enable discovery by alias",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );
    const labelQuad = quad(
      namedNode(AURELIA),
      namedNode(RDFS_LABEL),
      literal("Kingdom of Aurelia"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad, labelQuad],
      deletions: [],
    });

    const searchIndex = new LibsqlSearchIndex({
      client,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const discovery = await searchIndex.search({ query: "Kingdom" });
    assertEquals(
      discovery.results?.some((result) => result.subject === AURELIA),
      true,
    );
    assertEquals(
      discovery.results?.some((result) => result.predicate === HAS_CAPITAL),
      true,
    );
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - rebuild refreshes fts_value after schema-style reindex",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad],
      deletions: [],
    });

    await client.execute({
      sql: "UPDATE chunks SET fts_value = ? WHERE predicate = ?",
      args: ["Lume", HAS_CAPITAL],
    });
    await client.execute(
      testLibsqlSchemaBuilder.buildRebuildChunksFtsIndex(),
    );

    const rebuildResult = await rebuildLibsqlSearchIndexFromQuads({
      client,
      textSplitter: sharedTextSplitter,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    assertEquals(rebuildResult.processedQuadCount, 1);
    assertEquals(rebuildResult.chunkRowCount, 1);

    const chunkRows = await client.execute(
      "SELECT value, fts_value FROM chunks",
    );
    assertEquals(chunkRows.rows[0].value, "Lume");
    assertEquals(
      String(chunkRows.rows[0].fts_value).includes("Aurelia"),
      true,
    );

    const searchIndex = new LibsqlSearchIndex({
      client,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });
    const discovery = await searchIndex.search({ query: "Aurelia" });
    assertExists(discovery.results?.[0]);
    assertEquals(discovery.results?.[0].subject, AURELIA);
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - extended labelPredicates union is indexed",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
        labelPredicates: [CUSTOM_LABEL],
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
      labelPredicates: [CUSTOM_LABEL],
    });

    const entity = "http://example.org/Entity";
    const factQuad = quad(
      namedNode(entity),
      namedNode("http://example.org/description"),
      literal("A remote outpost"),
    );
    const customLabelQuad = quad(
      namedNode(entity),
      namedNode(CUSTOM_LABEL),
      literal("Outpost Alpha"),
    );

    await persistHooks.commit({
      insertions: [factQuad, customLabelQuad],
      deletions: [],
    });

    const predicates = resolveLabelPredicates([CUSTOM_LABEL]);
    assertEquals(predicates.includes(CUSTOM_LABEL), true);
    assertEquals(predicates.includes(RDFS_LABEL), true);

    const searchIndex = new LibsqlSearchIndex({
      client,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const discovery = await searchIndex.search({ query: "Outpost" });
    assertEquals(
      discovery.results?.some((result) => result.subject === entity),
      true,
    );
    assertEquals(
      discovery.results?.some((result) =>
        result.predicate === "http://example.org/description"
      ),
      true,
    );
  },
);

Deno.test(
  "rebuildLibsqlSearchIndexFromQuads - label update fan-out refreshes sibling fact chunks",
  async () => {
    const client = createClient({ url: ":memory:" });
    await setupLibsqlSchemaForTest(client);

    const persistHooks = createLibsqlPersistHooks({
      client,
      searchIndexProjector: new LibsqlSearchIndexProjector({
        client,
        textSplitter: sharedTextSplitter,
        searchQueryBuilder: testLibsqlSearchQueryBuilder,
        embeddingService: new FakeEmbeddingService(),
      }),
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });

    const capitalQuad = quad(
      namedNode(AURELIA),
      namedNode(HAS_CAPITAL),
      literal("Lume"),
    );

    await persistHooks.commit({
      insertions: [capitalQuad],
      deletions: [],
    });

    await persistHooks.commit({
      insertions: [
        quad(
          namedNode(AURELIA),
          namedNode(RDFS_LABEL),
          literal("New Kingdom Name"),
        ),
      ],
      deletions: [],
    });

    const capitalChunk = await client.execute({
      sql: "SELECT fts_value FROM chunks WHERE predicate = ?",
      args: [HAS_CAPITAL],
    });
    assertEquals(
      String(capitalChunk.rows[0].fts_value).includes("New Kingdom Name"),
      true,
    );

    const searchIndex = new LibsqlSearchIndex({
      client,
      searchQueryBuilder: testLibsqlSearchQueryBuilder,
    });
    const discovery = await searchIndex.search({ query: "New Kingdom" });
    const capitalHit = discovery.results?.find((result) =>
      result.predicate === HAS_CAPITAL
    );
    assertEquals(capitalHit?.subject, AURELIA);
    assertEquals(capitalHit?.text, "Lume");
  },
);
