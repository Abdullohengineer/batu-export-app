## 2026-08-29 — Partiya raqami (per-type arrival batch number)
**Context:** Task asked for a per-type arrival batch number on every `kirim_lines` row ("partiya
raqami"), shown next to the serial everywhere a serial appears — Laborator KIRIM/CHIQIM, Ombor's
four tabs, Menejer's KIRIM list and CHIQIM raw picker, Qorovul's gate queue, the serial passport,
Hisobot (as a new filterable column), and the Global Export client portal.

**Two wrong premises in the task's own brief, caught by schema inspection (CLAUDE.md "Inspect live/
migration schema before assuming") before writing any code:**
- The brief's own suggested tie-break, `kirim_lines.id`, doesn't exist — `kirim_lines`' PK is the
  generated text `serial`, no surrogate id column at all.
- The brief's own memory of the arrival-date column, `kirim_orders.arrival_date`, doesn't exist —
  the real column is `order_date`, already what every other read path in this codebase treats as
  "arrival" (`report_kirim_rows` aliases it `date_basis`/`arrival_date`).

Both corrected, then surfaced via `AskUserQuestion` rather than silently substituted (CLAUDE.md
"stop, report, do not invent a design" for ambiguous premises) — confirmed with the user:
**ordering key** `(kirim_orders.order_date, kirim_orders.created_at, kirim_lines.serial)`
(order_date for the date, the order's own created_at to break same-date ties between orders, serial
as the final tie-break between two lines of the same type on one multi-type order); **assignment
timing** eager, at `kirim_lines` INSERT time (matches order_date already being decided at that
point, and avoids a visible gap on Menejer's own screens between line creation and Ombor's later
intake confirmation).

**A third, self-contradiction in the brief itself:** one line said `kirim_lines.partiya_no int not
null`, two other lines said opening-stock rows leave it null, displayed as a blank badge never "0"
or "1". The column cannot be both — resolved in favor of the unambiguous, twice-stated requirement
(plain nullable `int`, no NOT NULL constraint), documented as a deliberate correction in the
migration's own header rather than silently picking one side.

**Decision — mechanism:** a `partiya_counter` table (one row per `type_id`, RLS-locked with zero
policies, same shape as the existing `serial_counter`), advanced by a `security definer` BEFORE
INSERT trigger on `kirim_lines` doing an atomic `insert ... on conflict (type_id) do update set
last_no = last_no + 1 returning last_no` — not a live `count(*) + 1` scan, which would race under
two concurrent Menejer submissions for the same type. Origin-gated inside the trigger: only
`kirim_orders.origin = 'delivery'` rows get a number; `opening_stock`/`internal_reprocess` leave
`new.partiya_no` untouched (stays NULL). A second trigger enforces immutability (`old.partiya_no is
not null and new is distinct from old → raise exception`) — defense in depth, since `kirim_lines`
has no UPDATE policy for any role today anyway. Backfilled once for every pre-existing
`origin='delivery'` row via the same ordering key, guarded `where partiya_no is null` so a re-run is
a no-op. `supabase/migrations/0093_kirim_lines_partiya_no.sql` — applied, backfilled (Subxon 1-16,
Isfara 1-3 on the live data at apply time), and verified: a disposable `TEST-PARTIYA-1/2/3` SQL-level
fixture (Subxon-only → Subxon+Isfara mixed → Isfara-only) confirmed Subxon numbered 1,2 and Isfara
1,2 within that isolated run, immutability trigger refused a direct `UPDATE ... SET partiya_no`, and
origin-gating correctly left an `opening_stock` fixture's `partiya_no` null.

**Incident, disclosed per CLAUDE.md "Testing workflow":** the isolated SQL fixture above was hard-
deleted after verification (a legitimate disposable SQL-only fixture, not app-visible data), but this
left `partiya_counter.last_no` advanced to the fixture's own consumed values (Subxon 18, Isfara 5)
even though real data's actual max had dropped back to 16/3 after cleanup — a counter-drift, not a
numbering-logic bug, but one that would have caused the NEXT real arrival of either type to jump
ahead by the fixture count instead of continuing 1-past the last real row. Caught by a drift-check
query (`counter.last_no` vs `max(kirim_lines.partiya_no)` per type) immediately after cleanup, fixed
with `update partiya_counter set last_no = coalesce((select max(partiya_no) from kirim_lines where
type_id = pc.type_id), 0)`, re-verified both types' counters exactly match real data again. Recorded
here as the standing risk with ANY fixture that exercises this trigger — the e2e spec below
(`tests/e2e/partiya-raqami.spec.ts`) carries its own `resyncPartiyaCounter` teardown step for exactly
this reason, run after every test that creates real `kirim_lines` rows.

**Read-path migration (`0094_partiya_no_read_path.sql`) — a real Postgres signature-change discovery
along the way:** the first apply attempt failed with `ERROR 42P16: cannot change name of view column
"calibre_id" to "partiya_no"`. `CREATE OR REPLACE VIEW` only allows APPENDING a new output column at
the very end of the SELECT list — inserting one in the middle (originally placed right after
`type_id`, before `calibre_id`, to read naturally next to the serial) shifts every column after it,
which Postgres reads as an implicit, disallowed rename of each shifted column. Fixed by moving
`partiya_no` to the LAST column of every view's own outer/exposed SELECT list (CTEs inside a view
are NOT "view columns" and are unaffected by this rule, so it stays wherever convenient inside
those). The same restriction applies even harder to any function using `RETURNS TABLE`
(`report_kirim_rows_as_of`, `report_query_page`, `client_filtered_report_rows`,
`client_report_rows`): `CREATE OR REPLACE FUNCTION` refuses ANY change to the OUT-parameter list —
RETURNS TABLE is implemented as OUT parameters — regardless of position; appending one still errors
"cannot change return type of existing function." Those four (plus the two new
`report_filtered_rows`/`report_totals` parameter additions below) needed `DROP FUNCTION` +
`CREATE FUNCTION` instead, each with the exact live argument-type list first. Sixteen objects
threaded through in total: `report_kirim_rows`, `report_kirim_rows_as_of`, `report_chiqim_rows`,
`report_moyka_output_rows`, `report_moyka_send_rows`, `report_raw_dispatch_rows`,
`report_old_kn_rows` (no serial at all — `null::int`, for shape consistency with the other five in
the union below), `report_rows_v2`, `report_query_page`, `stock_on_hand_rows`, `wip_rows`,
`yield_rows`, `get_serial_passport`, `get_client_report`, `client_filtered_report_rows`,
`client_serial_summary` — the last four are `jsonb`-returning, unaffected by the RETURNS TABLE
restriction, `CREATE OR REPLACE FUNCTION` worked fine for them.

**A gap in that same 16-object list, found while wiring the client-portal TS layer, fixed in
`0095_client_report_rows_partiya_no.sql`:** `client_report_rows` (the actual RPC
`clientPortalReport.ts` calls) wraps `client_filtered_report_rows` but has its OWN explicit
`RETURNS TABLE` selecting NAMED columns from `f`, not `f.*` — so it did not inherit the new column
automatically the way `report_query_page`'s `select f.*, ...` over `report_filtered_rows` does.
Caught by reasoning through what the frontend actually calls (`clientPortalReport.ts`'s own
`.rpc('client_report_rows', ...)`), not by re-deriving the read-path list from scratch — same
DROP+CREATE fix.

**Hisobot's own "filterable, visible column" requirement — a genuine SQL parameter addition, not
just a new display column:** `report_query_page` is LIMIT/OFFSET paginated server-side, so a
client-side narrow of an already-fetched page would silently miss matches beyond it. Added
`p_partiya_no integer default null` to `report_filtered_rows` (`0096_report_partiya_no_filter.sql`)
and threaded it through `report_query_page` in the same migration, then discovered `report_totals`
(the totals-strip RPC) ALSO calls `report_filtered_rows` and would otherwise silently sum the FULL
unfiltered set while the row table showed a partiya-filtered subset — added the same parameter there
too (`0097_report_totals_partiya_no_filter.sql`). All three parameter additions used `default null`
appended at the end specifically so every existing positional caller (`report_totals` itself calling
`report_filtered_rows` with exactly its old 13 args) keeps resolving correctly against the new,
longer signature — confirmed live (see Verified below) rather than assumed. Filter UI: an exact-match
number input (`ReportFilterBar.tsx`'s "Ko'proq filtrlar" panel, `type="number"`) — never substring
`ilike` like serial/barcode2, since "2" must never also match "20".

**"Sortable per type" interpretation, not escalated:** the existing Hisobot table has no click-to-
sort UI on ANY column today (fixed `order by date_basis desc, row_key desc`). Read as describing a
data-SHAPE property (partiya numbers are meaningfully ordered once a user filters to one type) 
rather than a request for a brand-new generic column-sort mechanism — a scope-proportionate reading
of one subordinate clause in a much larger brief, not silently decided without disclosure (recorded
here). Implemented as a plain visible+filterable column, no new sort UI.

**Legacy overloads left untouched, confirmed unused before skipping:** the singular
`report_query_page(p_direction text, ...)` / `report_filtered_rows(p_direction text, ...)` /
`report_totals(p_direction text, ...)` overloads and the old `report_rows` view (pre-dating the
`p_directions text[]` multi-select direction filter) are dead code — the app only ever calls the
plural `text[]` overloads (`useReportQuery.ts`'s own `toRpcParams` always builds `p_directions:
string[] | null`). Confirmed via `reportQuery.ts`/`useReportQuery.ts` before deciding to skip, not
assumed; `rahbar_dashboard_ledger`/`rahbar_stock_snapshot` (aggregate-only, no per-serial listing)
and `old_stock_closeout_lines` (owner+type aggregate) are likewise out of scope — none display a
serial.

**Frontend:** new `src/components/ui/PartiyaBadge.tsx` — a small amber pill ("P{n}"), reusing the
design system's own `pending` tone (the same precedent `OmborChiqimTab.tsx`'s `oldStockBadge` set
for "reuse the amber palette rather than inventing a new color"), returning `null` (no badge, not
"0"/"1") when `partiyaNo` is null. `partiyaNo`/`partiya_no` threaded through every serial-carrying
hook (`useMoykaSerials`, `useMoykaOutput`, `useIntakeLines`, `useIntakeHistory`,
`useLaboratorKirim`, `useLaboratorChiqim`, `useLaboratorHistory`, `useKirimTrips`) and every
report/RPC-mapper file (`reportQuery.ts`'s `ReportDbRow` + all 5 serial-carrying row kinds +
`mapDbRowToReportRow`; `stockOnHand.ts`/`useStockOnHand.ts`; `wip.ts`/`useWipRows.ts`;
`yield.ts`/`useYieldRows.ts`; `serialPassport.ts`; `clientReport.ts`; `clientPortalReport.ts`), then
rendered next to the serial across ~30 components spanning Laborator (KIRIM/CHIQIM live+Tarix+all 4
Tahlil forms), Ombor (Moyka/Intake/Chiqim/receive-from-Moyka/new-stock-to-Moyka/Hisobotlar),
Menejer (KIRIM orders list, CHIQIM raw-serial pool picker + its saved-draws list), Qorovul (KIRIM
gate queue), Hisobot (`ReportTableRow`'s serial cell AND its own new `partiya` column,
`ReportRowCard`, all 5 row-detail components, `StockOnHandTable`, `WipTable`, `YieldTable`), the
serial passport modal (header reworked to "Seriya: X · Partiya: Y (Tur)", prominently, matching the
task's own exact requested format), and the client portal (`ClientHisobotTab`, its serial-summary
modal, and the internal `ClientReportTab`'s quality-record table).

**Verified live, directly against real data (not just SQL-level unit assertions):**
`report_kirim_rows`/`report_query_page`/`stock_on_hand_rows`/`wip_rows`/`yield_rows` all return the
correct `partiya_no` for real serials; `get_serial_passport('290726-068')` returns
`order.partiyaNo = 1`; `get_client_report(...)`'s `qualityRecord[].partiyaNo` returns the correct
mixed-type sequence (`[1,1,2,3,4,5,2,6,8,7,3,9,10,12,11,13,14,15,null,16]` across two product types
in one period — the interleaving itself confirms two independent per-type sequences, not one shared
counter); `client_serial_summary`/`client_report_rows`/`client_filtered_report_rows` all compile and
execute cleanly (return empty under a service-role/no-owner SQL console session, as expected — these
three gate on `my_owner_id()`, which is null outside a real authenticated client session; not a bug,
confirmed by `get_client_report`'s own positive result above exercising the identical underlying
data through a path that doesn't require that gate). `npx tsc -b --noEmit` clean, `npx oxlint` clean,
`node --test` 52/52, `npm run build` succeeds.

**Not executed this session:** `tests/e2e/partiya-raqami.spec.ts` (two specs — the three-arrival
per-type sequencing scenario with a Laborator-queue badge check, and an opening-stock-shows-no-badge
check against Ombor qoldig'i with "Eski zaxira" toggled) is written, ad-hoc typechecked clean against
this repo's actual tsconfig options (zero errors in the new file or its `resyncPartiyaCounter`
teardown addition), and follows this suite's established fixture/teardown/role-switching
conventions throughout — but **not run**, same disclosed limitation as the CHIQIM FIFO work earlier
in this same file: this sandbox has no `.env.test` (test-role credentials), so there is no way to
actually launch a browser session against the live app here. Flagged explicitly rather than claimed;
whoever picks this up next should run `npx playwright test partiya-raqami` locally, where
`.env.test` exists, before treating this as end-to-end-verified.

**Not built — flagged, not silently skipped:** the task's own read list named `useAvailableFinishedStock`/
`useOmborChiqimRequests` as sites needing `partiyaNo` — investigated directly and confirmed neither
selects `kirim_lines` or any of the 16 updated read-path objects (they read `chiqim_lines`/
`chiqim_requests`/`finished_pallets`/`finished_calibre_availability` instead, none of which carry a
serial's own arrival batch number as a concept). No number to show there; not a gap, a premise in
the task's own brief that didn't hold once checked against the actual query shape.
