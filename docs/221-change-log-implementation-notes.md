# Change log implementation notes

First slice of worlds-sdk-ts #221, on branch `221-change-log`. The change log
is an opt-in, append-only record of fact-level history beside the current-state
quads. Current-state quads and hexastore indexes are unchanged, so query speed
and SPARQL behaviour are unchanged.

## What landed

An in-memory change log at the patch-commit boundary, the single place
in-memory mutations flow through in this package: `RdfjsQuadStore.import`
builds a `Transaction`, the transaction commits a deduplicated patch, and the
store records change-log entries for that patch after the commit handler
succeeds.

New API surface, all exported through `@worlds/sdk/quad-store`:

- `ChangeLogOperation`, `ChangeLogEntry`, `ChangeLogEntryInput`,
  `ChangeLogListQuery`, and `ChangeLogStore` in
  `src/client/quad-store/change-log/change-log-store.ts`. Each entry carries a
  store-scoped sequence number, transaction id, transaction time, operation
  (`add` or `remove`), the quad and its content-addressed id, plus an optional
  actor and source.
- `InMemoryChangeLogStore` in
  `src/client/quad-store/change-log/in-memory-change-log-store.ts`. Append-only,
  with `record`, `list`, `history`, `asOf`, and `asOfSequence`. As-of
  reconstruction replays entries in sequence order; the sequence number is the
  durable cursor because wall-clock timestamps can tie within one millisecond.
- `recordPatchChangeLog` in
  `src/client/quad-store/change-log/record-patch-change-log.ts`. It records
  removal entries for deletions and replace-mode prior quads, and add entries
  for insertions, all grouped under one transaction id. Quads the q2 scheme
  cannot content-address are skipped rather than failing the import, mirroring
  `recordPatchProvenance`.
- `RdfjsQuadStore` gains `changeLogEnabled` (off by default) and an injectable
  `changeLogStore` (defaults to a store-scoped `InMemoryChangeLogStore`). The
  actor is the import provenance writer and the source is the import provenance
  source, both supplied on import; no new context field was added.

## Atomicity, as far as the in-memory path allows

The log is recorded only after the commit handler succeeds and only when the
log is enabled, so a failed commit writes no log rows, an empty import writes
no log rows, and a rollback before commit writes no log rows. The in-memory
append itself is an array push that cannot fail for hashable quads. True
atomicity, one database transaction holding both the quad mutation and the log
row, is the durable adapter's job and is not claimed here. Durable adapters
call `recordPatchChangeLog` inside their own transaction; see the next slice
below.

## What was deliberately left out

- Hash chain for tamper evidence. Later work, per #221.
- SHACL validation on writes. Later work, per #221, and owned by #151.
- Adapter tables for libsql, postgres, sqlite, indexeddb, and cloudflare.
  Those live in separate packages or later work; this slice is in-memory only.
- A `WorldsSdk` change-log facade. The query surface in this slice is
  `quadStore.changeLogStore` plus the exported `recordPatchChangeLog` helper.
  A facade mirroring `WorldsSdk.provenance` is a follow-up once a durable
  adapter exists.
- No change to the default. The log is off by default, per #221.

## Known gaps in this slice

- SPARQL updates bypass this log. The SPARQL engine writes straight to the
  underlying store and does not go through `Transaction` or
  `RdfjsQuadStore.import`, so SPARQL UPDATEs are not logged in this slice. A
  later slice must hook the SPARQL commit path or route SPARQL updates through
  a transaction.
- Direct `Transaction` users outside `RdfjsQuadStore` get no logging unless
  they call `recordPatchChangeLog` in their own commit handler. That is the
  intended hook for durable adapters.
- As-of reconstruction is only accurate from the point logging was enabled. A
  removal of a quad added before logging is a no-op in replay, and quads
  written before logging have no entries.

## Open questions from #221, recorded not decided

- Is the per-world opt-in the right default, or should history be on for new
  worlds? Still open. This slice keeps off by default, per the #221 proposal.
- Can every adapter write the log row atomically with the quad mutation? Not
  yet checked for postgres, sqlite, indexeddb, and cloudflare. The libsql
  adapter is the next slice; the others remain unchecked.
- Does the log replace or complement the named-graph convention for
  provenance? Decided November 27: it complements named-graph provenance, it
  does not replace it. The #257 sidecar stays as storage, reification and
  RDF-star are rejected as storage, `recordedAt` is write time only, and
  `validFrom` and `validTo` are out of scope for #257.
- Does import add to a world or replace it? Unverified; it changes what the
  log records. This slice logs both: merge imports log adds, replace imports
  log removals for wiped quads plus adds for the new quads.

## Next slice for a durable libsql adapter

The libsql adapter lives outside this repo, in `@worlds/libsql`. Its slice is:
add one change-log table beside the quads, call `recordPatchChangeLog` inside
the same database transaction as the quad mutation so the log row and the
mutation land or fail together, wire the per-world flag off by default, and
prove it with a test that kills the transaction mid-commit and finds neither
the quad nor the log row. After that, the SPARQL update path and a
`WorldsSdk` change-log facade are the remaining gaps before the log can be
claimed end to end.
