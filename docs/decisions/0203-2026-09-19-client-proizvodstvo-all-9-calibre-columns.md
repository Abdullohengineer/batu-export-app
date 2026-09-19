# Client Производство: all 9 calibre columns always render (was a hardcoded 6-subset)

## Investigation (frontend column derivation, not RPC shape)

`client_production_ledger()`'s `by_calibre`/`totals_by_calibre` CTEs group
by `calibre_id` with no code-based restriction at all — confirmed via
`pg_get_functiondef` — so the RPC already returns every calibre present in
the filtered period, unfiltered. Confirmed live for the TEST client
(2026-07-15..2026-09-19): real production data exists for calibre codes
`01, 02, 04, 06, 08, KN` (K3/K5/K7 are genuinely zero this period, not
excluded — the RPC would return them too if they had data).

The actual cause is entirely in the frontend:
`clientProductionLedger.ts`'s `PRODUCTION_CALIBRE_CODES` was a **hardcoded,
static 6-entry array** (`['01','02','03','04','06','KN']`) — not derived
from the ledger response at all, and not filtering out empty calibres
dynamically either. It was the original v1.47 build's own deliberate
design ("the task's own fixed column set... deliberately narrower than
every calibre this app has"), confirmed unchanged from `main` (`git diff
origin/main -- src/lib/clientProductionLedger.ts
src/pages/client/ClientProizvodstvoTab.tsx
src/lib/clientProductionLedgerExport.ts` — empty). K8 was never a column
at all under the old design, regardless of data; K3 was always a column,
showing "—" whenever empty. This explains the report exactly: real K8
production existed and had nowhere to render, while K3 (present as an
always-empty column) may have read as "missing" too depending on which
columns were scanned.

## Fix

`PRODUCTION_CALIBRE_CODES` widened to all 9: `['01'..'08', 'KN']`.
`ClientProizvodstvoTab.tsx`'s `COLUMN_LABEL` map gained the 3 missing
entries (K5/K7/K8). No RPC/migration change — `client_production_ledger()`
was never the constraint. `clientProductionLedgerExport.ts` (the Excel
download) is intentionally left as-is: it already derives its columns
from calibres actually present in the data (a genuinely different,
reasonable design for a spreadsheet — no all-zero columns cluttering a
download), unrelated to the on-screen table's own hardcoded-list bug;
only its comment was updated to stop describing the on-screen table as a
6-column subset.

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` — all clean.
- Live query against `client_production_ledger` for the TEST client,
  same period the report described: confirms `01,02,04,06,08,KN` have
  real data, `03,05,07` do not — the fix will show all 9, with the three
  empty ones rendering "—" rather than being absent.
