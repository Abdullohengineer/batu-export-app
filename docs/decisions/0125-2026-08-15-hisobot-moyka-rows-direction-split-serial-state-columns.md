## 2026-08-15 — Hisobot: Moyka rows, direction split, serial-state columns
**Context:** add Moyka send/output events as real `report_rows`, split `Yo'nalish` into 6
independently-filterable movement kinds, and add 7 serial-level "standing balance" volume columns
that repeat per row (Qabul qilingan, Omborda qoldi, Moykaga yuborilgan, Moykada, Moykadan chiqgan,
Xom holda jo'natilgan, Olib ketilgan). Continues the Hisobot column work from earlier the same day.

**Sourcing map (reported and confirmed before any SQL was written):** all 7 state figures already
exist somewhere in the codebase (`get_serial_passport`, `useMoykaSerials.ts`/`useMoykaOutput.ts`,
`rahbar_dashboard_ledger`) but as at least two independently-written copies each, sometimes
disagreeing (see below). None were re-derived from scratch. "Yo'qotish" was investigated and
**dropped from this batch** — no canonical per-serial loss-in-kg figure exists (only a locked
*percentage*, `wash_cycles.final_loss_pct`, and a completely differently-computed period-level kg
residual in the dashboard) — converting the percentage to kg would be new arithmetic on top of an
existing figure, exactly the thing "don't write new balance arithmetic" rules out. Shipping 7
columns, not 8; the canonical per-serial loss figure is its own future question.

**Reconciliation identity — verified, holds exactly, in every filter combination tested:**
`Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom holda jo'natilgan`, checked directly
against all 12 real accepted KIRIM serials (0 mismatches), then re-verified live through the actual
`report_totals` SQL under 5 different direction filters (Hammasi, KIRIM-only, MOYKAGA-only,
MOYKADAN-only, all-3-CHIQIM) — held exactly (to the kg) in every one, including the filtered
subsets where the serial set itself changes. Two figures independently cross-checked against
`rahbar_dashboard_ledger` for the same period: `total_kg_in` matched `raw.receivedKg` exactly
(74,375.4 kg); `state_moykada` matched `moykadaSnapshot.closingKg` exactly (23,887 kg).

**`kirim_line_state(p_serial)`** — one new function computing all 7 figures together (shared
subexpressions computed once), not 7 independent functions. Reuses `kirim_line_effective_qty`
(0072) for Qabul qilingan. Moykada/Moykadan-chiqgan/Olib-ketilgan all read from one `base_pallets`
CTE using the **exact exclusion set `rahbar_dashboard_ledger`'s own `pallets` CTE uses** (confirmed
by the user as the agreed source, not independently re-picked): drops pallets consumed into a
re-wash (via `serial_mint_sources` — consumed material produces its own separate output; counting
it here would double-count), voided, and storage-loss pallets. Unlike the ledger's own CTE, no
`p_to`/`p_from` gate anywhere — serial-state columns are explicitly as-of-now, never clipped to the
report's filter window (clipping breaks the reconciliation identity above).

**Two new row sources**, same 28-column shape every `report_*_rows` view already has:
`report_moyka_send_rows` (from `moyka_sends`, dated by `sent_date`, no waybill/plate/driver — these
are internal movements, confirmed schema-level) and `report_moyka_output_rows` (from
`finished_pallets`, dated by `received_date`).

🔒 **Four corrections made across two review rounds, before applying anything:**

1. **Production-safety fix, part one — additive overloads, not DROP+CREATE.** The first draft
   dropped and recreated `report_filtered_rows`/`report_query_page`/`report_totals` with a new
   `text[]` parameter, which would have 404'd every Hisobot user between the migration landing and
   the new frontend deploying (caught before applying, not after). Fixed by **adding** new
   `text[]`-parameter overloads alongside the existing `text`-parameter ones, which are left
   completely untouched. Postgres resolves overloads by parameter type; PostgREST resolves an RPC
   call by matching the JSON keys the client sends to a function's declared parameter names — old
   client sends `p_direction` (text), new client will send `p_directions` (text[]), genuinely
   different names as well as different types, so there's no ambiguity. Verified directly: took a
   snapshot of `report_totals('kirim', ...)`'s result before the migration, re-ran the identical
   call after, byte-identical — zero behavior change for the currently-deployed frontend.

1a. **Production-safety fix, part two — `report_rows` itself left untouched, not just the
   functions.** The additive-overload fix alone was still a breaking change: the first corrected
   draft added the two new Moyka branches directly to `report_rows`, which the OLD
   `text`-parameter `report_filtered_rows` also reads from — the deployed frontend would start
   receiving `moyka_send`/`moyka_output` kind values its mapper has never seen, shifting counts and
   pagination for every current user, not just erroring. Caught before applying. Fixed by creating
   a genuinely **separate** `report_rows_v2` view carrying all 6 branches (the original 4 plus the
   2 new ones); only the new `text[]`-parameter functions read from it. `report_rows` is not
   touched at all — the deployed frontend's entire read path
   (`report_rows` → `report_filtered_rows(text,...)` → …) structurally cannot see a Moyka-kind row,
   not merely "the filter happens to exclude them." Verified: `report_rows` row count identical
   before/after (97 rows, 0 of them Moyka-kind); `report_rows_v2` carries all 184. **Follow-up, not
   done in this migration:** once the new frontend is confirmed deployed and nothing calls the old
   `text`-parameter versions anymore, drop
   `report_filtered_rows`/`report_query_page`/`report_totals(text, ...)` in a cleanup migration,
   and consider renaming `report_rows_v2` → `report_rows` (dropping the old 4-branch one) at the
   same time. Recorded here so it isn't forgotten, not left as permanent parallel debt.

2. **`report_moyka_output_rows` deliberately NOT exclusion-filtered the same way
   `kirim_line_state` is.** The view emits a row for every `finished_pallets` entry regardless of
   status (voided/consumed/storage-loss included) — matching `report_chiqim_rows`' own confirmed
   philosophy exactly (that view has zero status filter beyond the TEST-plate exclusion; a
   voided/consumed pallet still gets a row there, with its real status visible via `pallet_status`,
   rather than disappearing). This is a ROW/EVENT log — "this pallet was produced on this date" is
   a historical fact that stays true even if the pallet is later voided or consumed into a
   re-wash — consistent with how `report_kirim_rows`' own Netto-on-arrival doesn't shrink just
   because the material later leaves storage. `kirim_line_state`'s exclusion set answers a
   different question ("how much of this serial's Moyka output is real, standing output right
   now"), so `total_kg_from_moyka` (this view's own row sum, an *activity* total under "Harakatlar
   bo'yicha") and `state_moykadan_chiqgan` (`kirim_line_state`'s filtered sum, a *standing-balance*
   total under "Seriyalar bo'yicha") are **expected to diverge** once a real voided/consumed/
   storage-loss pallet exists. Both read exactly 0 today (no real Moyka output yet in this data),
   so the divergence is currently untested by definition — flagged here and in SPEC.md so it's
   understood the first time it's nonzero, not rediscovered as a bug.

3. **"CHIQIM (tayyor)" is not "olib ketilgan"; the true semantics were confirmed, not assumed.**
   Re-read `report_chiqim_rows`' actual definition: it has **no status filter at all** beyond the
   TEST-plate exclusion — it emits a row for every `finished_pallets` entry regardless of current
   state, including merely-*reserved* (`band_qilingan`) pallets that haven't departed yet, dated by
   `chiqim_requests.request_date` (when the request was *created*), not by actual departure. A
   pallet still purely in stock with no request at all has `date_basis = NULL` and is invisible to
   the default date-ranged view (§3.2.3's existing rule — reachable only via an explicit Holat
   filter). So "CHIQIM (tayyor)" today means "linked to a dispatch request during this period,"
   which includes reserved-but-undeparted pallets, not only actually-collected ones. One real
   consequence: a pallet produced and then reserved within the same wide-enough window can
   legitimately appear as **two rows** under "Hammasi" — one MOYKADAN (the production event), one
   CHIQIM/tayyor (the request event) — for the same physical pallet. This is consistent with how
   this whole reporting engine already works (one physical object, one row per lifecycle event,
   e.g. a serial's own KIRIM row and its later CHIQIM row are already two separate rows for "the
   same material") — not a duplication bug introduced by this task. **The accurate departed
   figure is the `Olib ketilgan` state column** (`kirim_line_state`'s `departed` CTE /
   `report_totals.state_olib_ketilgan`), which specifically requires `gate_weighings.completed_at`
   to be set — the direction checkbox's own label was corrected to plain "CHIQIM (tayyor)" (see
   `ReportFilterBar.tsx`'s `DIRECTION_OPTIONS`) precisely so it stops implying that figure.

🔒 **Scaling note, recorded per explicit instruction — not a blocker today, not fixed:**
`kirim_line_state` runs once per **distinct serial** inside `report_totals`, and once per
**returned row** (bounded by `p_limit`, not the full filtered set) inside `report_query_page`.
Each call does ~5 subqueries plus a nested call to `kirim_line_effective_qty` (2-3 more). Fine at
today's data volume (17 `kirim_lines` total, 11-12 with intake). Will need real attention —
batching into a single set-returning query keyed by an array of serials, or a materialized/cached
state table — once a year of data means `report_totals` is calling this dozens to hundreds of
times per request. Flagged so it isn't rediscovered as a surprise, not addressed in this pass.

**Verification before presenting the SQL:** the full migration (additive overloads, two new views,
new `kirim_line_state` function) was run inside a `BEGIN…ROLLBACK` against live data twice — once
for the original DROP+CREATE draft (caught issue #1 before ever proposing to apply it for real),
once for the corrected additive version. The corrected version: reconciliation identity holds
exactly under 5 different direction filters; distinct-serial dedup confirmed (26 rows spanning 3
kinds → exactly 11 distinct-serial state totals, not 26, and a `chiqim_old_kn` row's `NULL` serial
correctly excluded without crashing); old-signature `report_totals('kirim', ...)` call produces a
byte-identical result before and after the migration; both signatures of all three functions
coexist without ambiguity; `report_moyka_output_rows` returns real data (79 rows) confirming it
isn't accidentally empty. Rolled back and reconfirmed zero objects persisted after each dry run.
Applied for real afterward, then re-verified live against production (not a dry run this time):
`report_rows` still 97 rows / 0 Moyka-kind; `report_rows_v2` 184 rows; both function-name overload
pairs present and callable.

**Frontend (branch `hisobot-moyka-rows-serial-state`, off `main`):** `reportColumns.ts` gained
`ReportColumnTotalBasis` (`'movement' | 'state' | 'both'`) and 7 new column entries, all
default-hidden. `reportQuery.ts`'s `ReportDirection` (3-value) replaced by `ReportRowKind` (6-value,
one per `report_rows_v2` kind); `ReportFilters.direction` → `directions: ReportRowKind[]`
(`[]` = no restriction). Two new row interfaces (`MoykaSendReportRow`, `MoykaOutputReportRow`) plus
a `SerialState` interface attached to every row kind except `chiqim_old_kn` (`state: null`,
genuinely inapplicable — no serial at all). `TotalsStrip.tsx` renders two labelled chip groups
("Harakatlar bo'yicha" / "Seriyalar bo'yicha (N ta seriya)"), driven generically by each visible
column's `totalBasis`; `moykaga_yuborilgan`/`moykadan_chiqgan` render one chip in each group,
labelled "(davrda)" and "(joriy)" respectively so the two colliding figures are never shown as one
unlabelled number — this labelling was extended to **both** pairs, not just "Moykadan chiqgan" (the
one example named in review): "Moykaga yuborilgan" collides the same way (a real movement total and
a real standing total under the same name) and needed the identical fix. `ReportFilterBar.tsx`'s
direction control changed from a 3-button pill toggle to a `FilterField` multi-select (reusing the
exact component the Ustunlar column picker already uses on this screen, per instruction). New
`MoykaSendRowDetail.tsx`/`MoykaOutputRowDetail.tsx` row-expand components, mirroring the existing
`RawDispatchRowDetail.tsx`/`ChiqimRowDetail.tsx` pattern. `ReportRowCard.tsx` (mobile) and
`reportExport.ts` (Excel) both needed explicit new branches for the 2 new kinds to stay type-safe
against the widened `ReportRow` union — neither was optional busywork: both had existing
fallthrough logic (`ReportRowCard`'s tone/label chain, `reportExport`'s final `else`) that would
have either thrown at runtime (`STATUS_LABEL[null]`) or silently mis-rendered a Moyka row as a
`ChiqimReportRow`. `tsc -b --noEmit` and `oxlint` both clean after all files landed.

**Live browser test results (16 Jul – 15 Aug, Menejer role, real data):** "Hammasi" baseline —
Kirim 74,375 kg / Chiqim 24,729 kg / Neto +49,646 kg, state group "11 ta seriya". Reconciliation
identity re-verified by hand against the live totals strip on all 11 distinct KIRIM serials in this
window — exact match on every one (down to the 6427.4/1418.4/800/4209 kg case, the one with a
fractional kg). Toggling direction to KIRIM-only: movement figures narrow to KIRIM's own
(Chiqim/Moyka movement totals drop to 0), state group **unchanged** (still 11 serials, same
figures) — confirms state totals are computed over the filtered row set's distinct serials, and
every one of those 11 serials still has a KIRIM row in this window, not that the filter is being
ignored. Toggling to MOYKAGA-only: state group correctly narrows to "8 ta seriya" (only the
serials that actually appear as a MOYKAGA row), Qabul qilingan drops from 74,375 to 51,893 — proof
state totals scope to the *filtered* distinct-serial set, not the whole database. MOYKADAN-only and
CHIQIM (eski KN)-only both correctly return zero rows (no real data of either kind exists yet in
this seed — consistent with the flagged "both read 0 today" divergence note above). Toggling a
single state column (`Olib ketilgan`) off/on removes/restores exactly its one chip from the state
group, nothing else — verified via the rendered totals text, not just visual inspection. Every
MOYKAGA row showed "—" (not "0") under E'lon qilingan/Hisobiy, confirming the blank-not-zero
convention held. Serial `280726-029` (appears on 3 rows — 1 MOYKAGA + 2 CHIQIM/xom in this window)
showed identical state figures on all 3 rows, and contributed to the state total exactly once (11
serials, not 26 rows) — "the trap" confirmed avoided on real data, not just by construction.
Expanded a MOYKAGA row: `MoykaSendRowDetail` rendered correctly ("Moykaga yuborildi: 7,320 kg" +
working passport link), no console error. `Tozalash` on the direction filter round-tripped back to
the exact "Hammasi" baseline figures. No `report_moyka_output_rows`/`state_moykadan_chiqgan`
divergence observable yet (both still read 0 — no real excluded-status Moyka output exists in this
data), as flagged above.
