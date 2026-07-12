/**
 * HexastoreIndexDescriptor names a single covering index on the quads table.
 */
export interface HexastoreIndexDescriptor {
  /** name is the index identifier (e.g. idx_quads_spog). */
  name: string;

  /** columns lists the ordered column group for the index. */
  columns: readonly [string, string, string] | readonly [
    string,
    string,
    string,
    string,
  ];
}

/**
 * HEXASTORE_INDEXES defines the 7 covering composite indexes on the quads table
 * enabling any quad pattern to be resolved via a single index seek.
 */
export const HEXASTORE_INDEXES: readonly HexastoreIndexDescriptor[] = [
  { name: "idx_quads_spog", columns: ["s", "p", "o", "g"] },
  { name: "idx_quads_sopg", columns: ["s", "o", "p", "g"] },
  { name: "idx_quads_pso", columns: ["p", "s", "o"] },
  { name: "idx_quads_pos", columns: ["p", "o", "s"] },
  { name: "idx_quads_ospg", columns: ["o", "s", "p", "g"] },
  { name: "idx_quads_opsg", columns: ["o", "p", "s", "g"] },
  { name: "idx_quads_gpso", columns: ["g", "p", "s", "o"] },
] as const;
