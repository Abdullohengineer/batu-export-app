## 2026-08-22 — Rahbar dashboard batch: Moykada stock category, Isfara correction, nav trim, Excel export column parity

**Context.** Five independent, user-reported items in one pass, mixed cosmetic/data/logic — kept
as five separate diffs rather than one blended one, called out individually below.

**1. Rahbar "Bosh sahifa" (Window 1, Zaxira tarkibi) was missing a whole category: material
already sent to Moyka but not yet returned as finished output.** `stock_on_hand_rows`' `raw_rows`
CTE already deducts `moyka_sends` from the raw balance the instant material is sent (so it
correctly vanishes from "Xom"), and `finished_pallets` only appears once Moyka actually returns
output (so it correctly doesn't appear in "Tayyor" early either) — the gap between those two
events was real material with no category of its own anywhere in `rahbar_stock_snapshot()`, the
point-in-time RPC Window 1's hero tiles/Silo/grand total actually read. The identical figure
already existed, just in the wrong RPC: `rahbar_dashboard_ledger()`'s own `moykadaSnapshot`
computes exactly this ("Moykada — nuqtadagi holat" card, already visible further down the same
page in "Kirim va chiqim") but that RPC is period-scoped and not what Window 1's snapshot reads.
Rather than reference across RPCs, `rahbar_stock_snapshot(p_scope)` gained its own `moyka_lines`/
`moykada_total` CTEs — byte-for-byte the same logic as the ledger's `moyka_in_process` CTE (same
`wash_cycle_status = 'final'` exclusion: a finalized cycle's own sent-vs-output gap is yield loss,
not material still physically in Moyka), minus the `p_to` parameter, since this RPC has no date
range — every other figure in it is already "right now." `moykadaKg` added to the returned JSON
and folded into `totalKg`; frontend (`rahbarDashboardV2.ts`/`useRahbarDashboardV2.ts`/
`RahbarHome.tsx`) gained a new sky-toned "Moykada" hero tile (grid widened 5→6 cols), a `Silo`
segment inserted between Xom and Tayyor-kalibrli (matching the real raw→moyka→finished flow), and
`grandTotal`/the grand-total box's itemized caption both include it. `supabase/migrations/
0080_rahbar_stock_snapshot_moykada.sql`.

**Dry-run before writing the migration, live re-verification after.** Ran the new CTEs as a plain
`execute_sql` query (no schema change) first — real data: 7 active-cycle lines, 24,278.4 kg
sent-not-yet-output (`origin='delivery'` only, nothing opening-stock currently mid-Moyka); 2
`final`-status lines correctly contributed 0. Applied, then re-queried `rahbar_stock_snapshot`
for all three scopes: `hammasi.totalKg` 235,130.4 = 68,817 (raw) + 59,280 (kalibrli) + 840 (KN) +
81,915 (eski KN) + 24,278.4 (moykada) — arithmetic holds exactly. `eski` scope correctly reads
`moykadaKg: 0` (no opening-stock line is currently mid-wash).

**2. Eski KN Isfara pool corrected 56,359 → 56,120 kg — a data correction, not a schema
change.** Confirmed first via direct query: exactly one Isfara `old_kn_pools` row exists (Global
Export Company), and it has zero `old_kn_collections`/`serial_mint_sources` against it, so the
*displayed* balance (`opening_kg − collected − minted`) already equals `opening_kg` unmodified —
this is a straight one-row `opening_kg` correction, same shape as the 2026-08-03 Qand/Qand Qizil
attribution fix (see that entry above), not a design change. Migration guarded on
`opening_kg = 56359` so it's a no-op rather than a silent double-apply if run twice.
`supabase/migrations/0081_old_kn_pools_isfara_correction.sql`. Verified live post-apply:
`old_kn_pools.opening_kg = 56120` for that row, and `rahbar_stock_snapshot('hammasi').oldKnKg`
reflects the corrected figure.

**Both migrations applied directly to the live Supabase project (no branch — this project's own
documented plan limitation), after explicit user confirmation per CLAUDE.md's "ask before
applying migrations" workflow rule** — both are genuine live-data/schema writes, batched into one
confirmation prompt rather than two separate interruptions.

**3. "Kutilayotgan ishlar" and "Hosildorlik" removed from Rahbar entirely, nav and routes both**
— pure frontend, no DB involved. `RahbarLayout.tsx`'s `NAV_ITEMS` dropped both entries (6→4
destinations); `App.tsx` dropped the matching `<Route path="kutilmoqda">`/`<Route
path="hosildorlik">` under `/rahbar` so the screens aren't reachable by direct URL either, not
just hidden from nav. `WipTab`/`YieldTab` themselves untouched — Menejer keeps both routes
(`/menejer/kutilmoqda`, `/menejer/hosildorlik`), same shared components, unaffected.

**4. Rahbar's Hisobot — investigated, found already correct, nothing changed.** The user asked
for "Yo'nalishlar" (direction filter) and "Ustunlar" (column picker) parity with Menejer's
Hisobot. Traced `/rahbar/hisobotlar` and `/menejer/hisobot` in `App.tsx`: both routes render the
literal same `<HisobotTab />` component, no props, no role branching anywhere inside it or inside
`ReportFilterBar.tsx`'s directions control (`onDirectionsChange && directions`, both always
passed unconditionally). The two screens are structurally identical today, including both
features asked for — nothing to fix in code. Flagged back to the user as likely a stale/cached
build rather than a real gap, rather than inventing a change with nothing to actually change.

**5. Excel export ignored the on-screen column picker entirely — the one real logic bug in this
batch.** `reportExport.ts`'s `buildReportWorkbook` used a hardcoded 11-column header and a
hardcoded per-row-kind cell array, predating the 2026-08-15 column-picker work — selecting new
columns via "Ustunlar," applying filters, and exporting produced a file with the same fixed
column set regardless, so newer columns (E'lon qilingan, Hisobiy, Namlik, SO₂, the six
serial-state columns) never reached the file no matter what was visible on screen. Rewritten to
be driven by `REPORT_COLUMNS`/`visibleColumnKeys` — the exact same registry `ReportResultsTable.tsx`
already filters/orders columns from — via a new `columnValue(row, key, lookups)` accessor mirroring
`ReportTableRow.tsx`'s `cellContent` switch (same blank-vs-zero rules) and a `statusText`/
`directionLabel` pair mirroring that file's 'status'/'direction' cell text exactly, kept in sync
by hand since one renders JSX and the other plain Excel values. `downloadReportExcel`/
`buildReportWorkbook` both gained a `visibleColumnKeys` parameter; `HisobotTab.tsx`'s
`handleExport` now passes its own `visibleColumnKeys` state through unchanged. A column added to
the picker in the future needs a `columnValue` branch to actually export, the same way it already
needs a `cellContent` branch to actually render — there is no longer a third, separately
hardcoded column list to fall out of sync.

**Verification.** `npx tsc -b --noEmit`, `npm run build`, `npm run lint` (one pre-existing
unrelated warning, unchanged) all clean; unit suite 82/82 unaffected (no existing logic changed,
only the export's column-selection layer). **No live-browser hand-verification** — same
`.env`/`.env.test` gap as the immediately-prior two entries this session (gitignored, absent from
a fresh clone) — the Excel file's actual column output, the new Moykada tile's rendering, and the
corrected Isfara figure on screen were not clicked through in a running dev server; flagged
explicitly rather than silently skipped, same as before.

**Out of scope:** item 4 (nothing to fix, per above). The client report's old-KN drill-down gap
noted in the immediately-prior entry — still open, still not this task's scope.
