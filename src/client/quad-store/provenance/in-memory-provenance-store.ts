import type {
  ProvenanceHistory,
  ProvenanceListQuery,
  ProvenanceRecord,
  ProvenanceRecordInput,
  ProvenanceStore,
} from "./provenance-store.ts";

/**
 * InMemoryProvenanceStore is an append-only provenance store. Records are
 * never mutated or deleted; indexes over quadId and supersedesQuadId keep
 * list and history walks off linear scans.
 */
export class InMemoryProvenanceStore implements ProvenanceStore {
  private readonly records: ProvenanceRecord[] = [];
  private readonly byQuadId = new Map<string, ProvenanceRecord[]>();
  private readonly bySupersedes = new Map<string, ProvenanceRecord[]>();

  public record(input: ProvenanceRecordInput): Promise<ProvenanceRecord> {
    const record: ProvenanceRecord = {
      ...input,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    this.records.push(record);
    appendToIndex(this.byQuadId, record.quadId, record);
    if (record.supersedesQuadId) {
      appendToIndex(this.bySupersedes, record.supersedesQuadId, record);
    }
    return Promise.resolve(record);
  }

  public list(query?: ProvenanceListQuery): Promise<ProvenanceRecord[]> {
    let matches: readonly ProvenanceRecord[];
    if (query?.quadId !== undefined) {
      matches = this.byQuadId.get(query.quadId) ?? [];
    } else {
      matches = this.records;
    }
    const filtered = query?.type !== undefined
      ? matches.filter((record) => (record.type ?? "write") === query.type)
      : matches;
    return Promise.resolve([...filtered]);
  }

  public history(quadId: string): Promise<ProvenanceHistory> {
    return Promise.resolve({
      quadId,
      supersedes: this.walkAncestors(quadId),
      supersededBy: this.walkDescendants(quadId),
    });
  }

  private walkAncestors(quadId: string): ProvenanceRecord[] {
    const ancestorIds = new Set<string>();
    const visited = new Set<string>([quadId]);
    const queue = [quadId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const record of this.byQuadId.get(current) ?? []) {
        const previous = record.supersedesQuadId;
        if (!previous || visited.has(previous)) continue;
        visited.add(previous);
        ancestorIds.add(previous);
        queue.push(previous);
      }
    }
    // One entry per ancestor quad: its latest record (for example, a quad
    // that was written and later tombstoned still appears once).
    const latest = new Map<string, ProvenanceRecord>();
    for (const id of ancestorIds) {
      for (const record of this.byQuadId.get(id) ?? []) {
        latest.set(id, record);
      }
    }
    return [...latest.values()];
  }

  private walkDescendants(quadId: string): ProvenanceRecord[] {
    const chain: ProvenanceRecord[] = [];
    const visited = new Set<string>([quadId]);
    const queue = [quadId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const record of this.bySupersedes.get(current) ?? []) {
        if (visited.has(record.quadId)) continue;
        visited.add(record.quadId);
        chain.push(record);
        queue.push(record.quadId);
      }
    }
    return chain;
  }
}

function appendToIndex(
  index: Map<string, ProvenanceRecord[]>,
  key: string,
  record: ProvenanceRecord,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(record);
  } else {
    index.set(key, [record]);
  }
}
