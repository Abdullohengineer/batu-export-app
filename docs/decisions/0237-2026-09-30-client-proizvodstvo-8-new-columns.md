## 2026-09-30 — Client Производство: 8 new per-serial columns

**Task:** add Партия, Дата прихода, По накладной, Приход нетто, Отправлено на
мойку, В мойке, Остаток сырья, Потеря to the existing Серия / Вид сырья /
Всего произведено / K1-K8 / Кондитерка table, same row-selection rules
(unchanged — one row per serial with output > 0 in the filter period, В
мойке is decoration only, never a filter).

**Schema corrections against the brief** (CLAUDE.md "inspect live/migration
schema before assuming table/column names or shape" — confirmed against the
live schema via Supabase MCP before writing any SQL, not assumed):
- `kirim_lines` has no `partiya` column — it's `partiya_no` (the same column
  every other report/ledger in this codebase already reads).
- `kirim_orders` has no `arrival_date` column — it's `order_date`.

Both corrected in the migration; not flagged as ambiguous since both are
unambiguous 1:1 renames, already established elsewhere in the schema (e.g.
`report_rows_v2.partiya_no`), not a shape difference needing a design
decision.

**Reuse** (CLAUDE.md "Reuse, don't rebuild" / task's own instruction not to
duplicate math already in shared functions):
- Приход нетто → `kirim_line_effective_qty(serial)`, unchanged.
- В мойке (end-of-period) → `kirim_line_moyka_asof(serial, p_to_date)`,
  unchanged.
- Потеря → `kirim_line_loss_range(serial, p_from_date, p_to_date)` — its
  "period-recognition" semantics (null unless a cycle closed inside the
  filter period, else the signed sent−output gap for that cycle) are exactly
  the task's own spec: "only when serial has wash_cycles.closed_at NOT NULL
  within period; blank otherwise." No new SQL written for this, only a call
  site added.
- Остаток сырья → reuses the exact `D - E - G` convention already
  established by `client_serial_ledger`'s own `ostatokSyryaKg` (migration
  0119, comment literally reads "D - E - G, always"): netto − vozvrat(as-of
  p_to_date) − moyka_sent(as-of p_to_date). `vozvrat` (raw material returned
  via `raw_dispatch_lines`) has no shared scalar helper of its own — its
  subquery is copied from that same precedent rather than invented fresh,
  and is NOT a displayed column (the task's own column list has no
  "Возврат"), only an internal term of this one formula.
- The as-of moyka-sent figure used inside that formula is deliberately a
  *different* number from the period-only Σ used for the displayed
  "Отправлено на мойку" column — same distinction the reporting engine
  already makes everywhere else between a period figure and its lifetime/
  as-of twin (e.g. `state_moykaga_yuborilgan` vs `state_moykaga_yuborilgan_
  lifetime` in `report_totals`).

**No behavior change to row selection**: `scoped_pallets`/`by_serial` (the
CTEs that decide which serials appear and their Всего произведено/K1-K8/
Кондитерка figures) are untouched, byte-for-byte, from migration 0114. The 8
new fields are joined on afterward from a new `serial_extra` CTE keyed by the
same `serial` set `by_serial` already produced.

**Totals bar**: added Σ Приход нетто, Σ Отправлено на мойку, Σ В мойке, Σ
Остаток сырья (all straightforward sums), and Σ Потеря — summed **only over
non-null poteryaKg rows** per the task's own instruction, computed
server-side in the RPC (not coerced through 0), consistent with how
`report_totals` already handles `state_yoqotish`.

**Files touched:**
- `supabase/migrations/0154_client_production_ledger_new_columns.sql` — the
  RPC change (verified syntactically in a rolled-back live transaction
  against the real project before writing this file; not applied
  persistently — see below).
- `src/lib/clientProductionLedger.ts` — row/totals TypeScript shapes +
  RPC-response mapping.
- `src/pages/client/ClientProizvodstvoTab.tsx` — table header/row cells
  (reuses `PartiyaBadge`, `formatDate`, `formatLossKg` — no new formatting
  helpers written) and the totals strip.
- `src/lib/clientProductionLedgerExport.ts` — Excel export, same column
  order as on-screen, reuses `toExcelDate`/`EXCEL_DATE_FORMAT`.

**Verification done this session:** `npx tsc -b` (clean), `npm run
lint:rpc-wrapper` (0 new violations — this file's RPC call already goes
through `callRpc`, untouched), `npm run lint` (oxlint — clean, only 2
pre-existing unrelated warnings), `npm run build` (clean). SQL syntax
verified by running the full `CREATE OR REPLACE FUNCTION` plus a sample call
inside a `BEGIN; ... ROLLBACK;` transaction directly against the live
project via Supabase MCP — confirmed it compiles and executes with no error,
then rolled back with nothing persisted.

**NOT applied to the live project this session**, per this project's "ask
before applying migrations to the live project" rule and the user's explicit
answer. The live `client_production_ledger` function is still the old
(pre-this-task) 6-field shape — the new columns will not appear in the
client portal until `0154_client_production_ledger_new_columns.sql` is
applied to the live database (e.g. Supabase MCP `apply_migration`, or the
SQL editor) and the app is redeployed with this commit's frontend changes.
No live/destructive end-to-end click-through was possible from this session
for the same reason noted in prior entries (no browser egress) — recommend
the project owner do one real Производство load as the TEST CLIENT account
after applying, to confirm past this SQL-level verification.
