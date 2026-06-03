import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { LibsqlSchemaBuilder } from "./libsql-schema-builder.ts";

const testSchemaBuilder = new LibsqlSchemaBuilder(32);

Deno.test("buildIndexes - returns 7 covering index DDL statements", () => {
  const indexes = testSchemaBuilder.buildIndexes();
  assertEquals(indexes.length, 7);

  const subjectFirstQuadPatternIndex = indexes.find((s: string) =>
    s.includes("idx_quads_spog")
  );
  assertEquals(
    subjectFirstQuadPatternIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_spog ON quads(s, p, o, g)",
  );

  const sopgIndex = indexes.find((s: string) => s.includes("idx_quads_sopg"));
  assertEquals(
    sopgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_sopg ON quads(s, o, p, g)",
  );

  const psoIndex = indexes.find((s: string) => s.includes("idx_quads_pso"));
  assertEquals(
    psoIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_pso ON quads(p, s, o)",
  );

  const posIndex = indexes.find((s: string) => s.includes("idx_quads_pos"));
  assertEquals(
    posIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_pos ON quads(p, o, s)",
  );

  const ospgIndex = indexes.find((s: string) => s.includes("idx_quads_ospg"));
  assertEquals(
    ospgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_ospg ON quads(o, s, p, g)",
  );

  const opsgIndex = indexes.find((s: string) => s.includes("idx_quads_opsg"));
  assertEquals(
    opsgIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_opsg ON quads(o, p, s, g)",
  );

  const gpsoIndex = indexes.find((s: string) => s.includes("idx_quads_gpso"));
  assertEquals(
    gpsoIndex,
    "CREATE INDEX IF NOT EXISTS idx_quads_gpso ON quads(g, p, s, o)",
  );
});

Deno.test("buildIndexes - indexes are idempotent (CREATE IF NOT EXISTS)", async () => {
  const db = createClient({ url: ":memory:" });
  await db.execute(testSchemaBuilder.buildLibsqlQuadsTable());

  for (const ddl of testSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }

  // Second pass must not throw
  for (const ddl of testSchemaBuilder.buildIndexes()) {
    await db.execute(ddl);
  }

  // Verify all 7 indexes exist
  const resultSet = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_quads_%'",
  );
  const indexNames = resultSet.rows.map((r) => String(r.name)).sort();
  assertEquals(indexNames, [
    "idx_quads_gpso",
    "idx_quads_opsg",
    "idx_quads_ospg",
    "idx_quads_pos",
    "idx_quads_pso",
    "idx_quads_sopg",
    "idx_quads_spog",
  ]);
});
