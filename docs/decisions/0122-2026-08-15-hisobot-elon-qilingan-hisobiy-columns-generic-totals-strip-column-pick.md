## 2026-08-15 — Hisobot: E'lon qilingan + Hisobiy columns, generic totals strip, column picker
**Context:** add "Nakladnoy" (declared/waybill figure) and "Hisobiy" (= least(netto, nakladnoy),
display-only, never the accounting basis) to Hisobot, restructure the column set behind a
picker, and make the totals strip sum whatever volume columns are currently visible instead of
five hardcoded fields.

**Naming collision, found before writing any code, resolved with the user rather than guessed:**
"Nakladnoy" already means something specific and user-facing in this exact app — the client's
attached waybill *photo* (`kirim_orders.doc_photo`), rendered with the literal label "Nakladnoy"
on the serial passport (`SerialPassportModal.tsx`) and referenced on Menejer's own KIRIM form
("Mijoz nakladnoyasini biriktirish"). A Hisobot column also titled "Nakladnoy" but holding a
*number* would sit one click away from that photo, on the identical row/serial, meaning
something different. Per CLAUDE.md's own rule ("if ambiguous after inspection: stop, report, do
not invent a design"), this was surfaced before implementation, with **"E'lon qilingan"**
proposed as the recommended fix — the term already established elsewhere in this app for this
exact field (the serial passport's own "E'lon qilingan: 7,325 kg" line, §2.16's "Declared" row).
The user approved that proposal over the alternatives offered. Zero changes to the passport
screen; zero new vocabulary invented — reuses a name that already means exactly this.

**Premise correction, also found before writing code:** the task described the KIRIM-side view
as "`report_kirim_rows_as_of`." That function exists, but it isn't a variant of the view Hisobot
reads — it's a separate, independently-maintained function used only by `get_client_report`
(confirmed via `pg_get_functiondef` and `docs/DECISIONS.md`'s own prior entry on it). Hisobot's
real call graph is `report_totals → report_filtered_rows → report_rows → report_kirim_rows` (the
plain view) — it never touches `report_kirim_rows_as_of`, today or under this change, so that
named constraint was automatically satisfied rather than something requiring active avoidance.

**Data availability, confirmed before adding anything:** `declared_qty` (`kirim_lines`'s own
column, the correct line-level figure — not `kirim_orders.declared_total`, which is truck-level
and would misattribute a multi-product truck) is already a column on `report_rows`/returned by
`report_query_page` — no new join, no query change needed to get it. It is structurally absent,
not just unpopulated, on `chiqim`/`chiqim_raw`/`chiqim_old_kn` rows: `NULL::numeric AS
declared_qty` at the view level, and no `declaredQty` field at all on `ChiqimReportRow`/
`RawDispatchReportRow`/`OldKnReportRow` — confirmed by reading all four view definitions and the
TypeScript row-type union directly. This is why Hisobiy renders blank, not zero, on every
non-KIRIM row: the concept doesn't exist there, by construction, at both the DB and the type
layer — not a coalesce trick papering over missing data.

**Decision — implementation:**
- **Column registry** (`src/lib/reportColumns.ts`, new): `REPORT_COLUMNS`, one ordered list, one
  source of truth for the table header, the row cells, and which columns the totals strip sums.
  Before this the column set was hardcoded independently in three places (table header, row
  cells, and — still separately, left untouched, out of scope this round — the Excel export's own
  header array) with nothing keeping them in sync; this fixes that for the two that needed it.
  Three kinds — **context** (never totalled), **volume** (every visible one auto-contributes to
  the totals strip), **measurement** (shown/hideable, never summed — averaging moisture across
  unrelated serials is meaningless). Seriya and Barcode #2 split from one merged column into two,
  matching the task's own column list. Namlik %/SO₂ ppm promoted from row-expand-only to real,
  hideable table columns.
- **Totals strip** (`TotalsStrip.tsx`, rewritten): loops over currently-visible volume columns
  and renders whatever chip-group each one maps to (`VOLUME_COLUMN_CHIPS`) — the generic part is
  the loop, not a uniform chip shape. Netto and Tara deliberately keep their existing multi-chip
  splits (kirim/chiqim/net for Netto; kirim/raw-dispatch for Tara, both already justified in this
  same file's v1.26-era comments) rather than collapsing to one number each, since undoing either
  split would silently re-sum figures that were split apart for a reason. E'lon qilingan and
  Hisobiy are single numbers — `declared_qty` has no "out" side to separate against.
- **Column picker**: no bespoke component. `ReportFilterBar.tsx`'s own `FilterField` (the
  existing checkbox-panel-behind-a-pill multi-select, already used for Kalibr/Mahsulot turi/
  Holat) was exported and reused directly, wired in `HisobotTab.tsx` independent of
  `ReportFilters` — visible-column state and query-filter state never touch each other, so hiding
  a column can never remove it as a filter. Local `useState`, not persisted; resets to spec'd
  defaults on reload, same as every other UI-only state on this screen.
- **`report_totals`** (`supabase/migrations/0071_report_totals_declared_hisobiy.sql`): the only
  SQL object that needed changing — `report_filtered_rows`/`report_query_page`/`report_rows`
  already pass `declared_qty`/`qty_kg` straight through. `total_declared` is a bare
  `sum(declared_qty)` — safe unguarded, since `declared_qty` is `NULL` on every non-kirim row and
  SQL's `SUM` already skips nulls per ordinary aggregate semantics. `total_hisobiy` is **not** a
  bare `least(qty_kg, declared_qty)` — confirmed live, deliberately, before writing this: Postgres
  `LEAST`/`GREATEST` *ignore* null arguments rather than propagating them (`select least(5::numeric,
  null::numeric)` → `5`, the opposite of ordinary comparison-operator null semantics). Since
  `declared_qty` is unconditionally null on every non-kirim row, a bare `least()` in a mixed-kind
  aggregate would have silently returned `qty_kg` itself for each one, making Hisobiy look like a
  real "capped" figure on rows where the concept doesn't exist at all. Guarded with `kind =
  'kirim'` instead, matching the pattern the function's own `total_kg_in`/`total_kg_tara_in`
  columns already use. Required `drop function` + `create function`, not `create or replace` —
  Postgres refuses to change a `RETURNS TABLE` shape in place (`42P13`) — the same pattern this
  function's own history already used three times (`0041`, `0043`, `0063`). Grants: `report_totals`
  only ever carried Postgres's default `PUBLIC EXECUTE` (no explicit `REVOKE` was ever applied to
  it, unlike a `security definer` RPC) — confirmed identical before and after the drop+recreate,
  since a fresh `CREATE FUNCTION` gets the same default grant automatically.

**Testing:** live browser session against the real dev server + this same database, plus a
direct SQL cross-check. For 2026-07-16–2026-08-11 (both directions, no other filters): **Netto
66,428.4 kg, E'lon qilingan 66,276 kg, Hisobiy 66,264.4 kg** — matched exactly between the direct
`select * from report_totals(...)` call and the rendered UI. Sanity-checked the arithmetic
relationship holds (`Σ least(a,b) ≤ min(Σa, Σb)`: 66,264.4 ≤ min(66,428.4, 66,276) = 66,276 ✓).
Per-row spot checks across the full 17-row result confirmed Hisobiy always picks the lower of
Netto/E'lon qilingan (e.g. `110826-002`: Netto 7,345, E'lon qilingan 7,300, Hisobiy 7,300; `110826-
001`: Netto 7,320, E'lon qilingan 7,325, Hisobiy 7,320) and that every CHIQIM (xom) row shows "—"
for both new columns, never "0". Toggled Hisobiy off via the column picker — its column and its
totals-strip chip both disappeared together, everything else unaffected; toggled it back on.
Filtered by Buyurtmachi = Boysun Quritilgan Mevalar (a hidden-by-default column, never enabled
during this test) — result set correctly narrowed to zero and the totals strip tracked to zero,
confirming a hidden column still filters. Toggled on Namlik %/SO₂ ppm — real values appear for
KIRIM/CHIQIM rows with lab results, blank for raw-dispatch rows (no lab test ever happens there)
and for a not-yet-tested fresh KIRIM row, and the totals strip stayed unaffected (measurement
columns never summed, confirmed). Row expand (dynamic `colSpan`, replacing the old hardcoded
`REPORT_TABLE_COLUMN_COUNT = 12`) verified working after multiple column-visibility changes.
`npx tsc -b --noEmit` and `npm run lint` clean. Zero server-side errors (`preview_logs`) across
the session; one client-console `400` observed, reproduced identically on an unrelated page after
a full reload with none of this round's changes in play, confirming it predates and is unrelated
to this work — noted rather than silently ignored, not chased further.

**Out of scope, not touched:** MOYKAGA/MOYKADAN movement rows and the serial-state columns
(separate build, per the task), Ombor navigation, Rezka, the Excel export's own column list
(still independently hardcoded — not wired to the new registry this round), any change to
`report_kirim_rows_as_of`, `stock_on_hand_rows`, `get_client_report`, or any dashboard function
(confirmed none are in `report_totals`'s call graph, so none needed touching).
