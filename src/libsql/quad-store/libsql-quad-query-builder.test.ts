import { assertEquals } from "@std/assert";
import {
  buildBulkInsertQuads,
  buildInsertQuad,
} from "./libsql-quad-query-builder.ts";

Deno.test(
  "buildBulkInsertQuads - chunks rows under SQLite host-parameter budget",
  () => {
    const insertQuadRows = Array.from({ length: 85 }, (_, index) => ({
      quad_id: `id-${index}`,
      s: `urn:s:${index}`,
      s_type: "NamedNode",
      p: "urn:p",
      o: `literal ${index}`,
      o_type: "Literal",
      o_datatype: null,
      o_lang: null,
      g: "",
      g_type: "DefaultGraph",
    }));

    const statements = buildBulkInsertQuads(
      insertQuadRows,
    );
    assertEquals(statements.length, 2);
    assertEquals(
      (statements[0].sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) ??
        []).length,
      80,
    );
    assertEquals(statements[0].args.length, 800);
    assertEquals(
      (statements[1].sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) ??
        []).length,
      5,
    );
    assertEquals(statements[1].args.length, 50);
  },
);

Deno.test(
  "buildBulkInsertQuads - single row matches buildInsertQuad shape",
  () => {
    const insertQuadRow = {
      quad_id: "quad-hash",
      s: "urn:subject",
      s_type: "NamedNode",
      p: "urn:predicate",
      o: "object text",
      o_type: "Literal",
      o_datatype: "http://www.w3.org/2001/XMLSchema#string",
      o_lang: "en",
      g: "urn:graph",
      g_type: "NamedNode",
    };

    const bulkStatement = buildBulkInsertQuads([
      insertQuadRow,
    ])[0];
    const singleStatement = buildInsertQuad(
      insertQuadRow,
    );

    assertEquals(bulkStatement.sql, singleStatement.sql);
    assertEquals(bulkStatement.args, singleStatement.args);
  },
);
