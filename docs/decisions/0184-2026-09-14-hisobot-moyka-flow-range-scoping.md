## 2026-09-14 — Hisobot moyka flow columns range-scoped (shared RPC, affects Приход too)

**Context:** Two prior read-only investigations this session established: (1) Hisobot's
Moykaga yuborilgan/Moykadan chiqgan/K1-K8/KN table cells and "(joriy)" chips were
lifetime-scoped — sourced from `kirim_line_state(serial)`/`kirim_line_calibre_output(serial)`,
neither of which takes a date argument — while the correctly-labelled "(davrda)" movement
chips sitting right next to them were already properly range-scoped; and (2) this specific
bug class affects 11 metrics (the moyka pair + 9 kalibr columns), confirmed live: summing
separate August and September reports double-counted every cross-month serial (e.g.
`state_moykaga_yuborilgan`: 73,064 + 78,318 = 151,382 against a true combined-range 112,610).
Yo'qotish is a 12th affected metric, explicitly deferred to a later task. Full SQL archived
at `docs/data-corrections/2026-09-14_hisobot-moyka-flow-range-scoping.sql`.

### Shared-RPC scope, not Hisobot-only

A caller audit (required before touching `report_query_page`/`report_totals`, since both
change return shape) found that the client portal's Приход screen
(`ClientPrihodTab.tsx`) calls these exact same two RPCs directly — its own header comment
states this is deliberate ("same data-fetching layer... unchanged — NOT a parallel RPC").
Приход hardcodes all of the affected columns into its fixed `CLIENT_PRIHOD_COLUMN_KEYS` list
(fully visible, no column picker to hide them) and its bespoke `ClientTotalsStrip` reads the
identical `report_totals` fields under Russian labels ("за период"/"сейчас"). Checked before
applying: all 5 known cross-month serials belong to one client, "Global Export Company," who
will see real, visible number changes on Приход as a direct consequence of this fix.
**Decision, made explicitly rather than defaulted into:** accept the shared-RPC consequence —
Приход gets the same fix, not a fork. Forking would mean deliberately preserving wrong
numbers on a client-facing screen and maintaining two diverging copies of report-engine
logic, which the "not a parallel RPC" comment already establishes as against this codebase's
own stated intent. Client profile Hisobot as a design surface is otherwise untouched by this
task — its own bespoke rendering (`ClientPrihodTab.tsx`, `ClientTotalsStrip`) is not modified,
only the shared data it reads.

**Per-month figures on the client profile report are a known future need**, not a "known
future need" deferred from this task — see the section above: it already received the same
range-scoping treatment as Rahbar/Menejer's Hisobot, via the same shared RPC, in this same
change.

### Mechanism

Two new range-scoped sibling functions, each mirroring an existing pattern exactly (no new
pattern invented):
- `kirim_line_moyka_range(p_serial, p_from, p_to)` — mirrors `report_moyka_output_rows_by_serial`'s
  own exclusion basis (same view, `report_moyka_output_rows`, same predicate), exact-match on
  serial instead of its `ilike` substring match (safe for a per-row lateral join).
- `kirim_line_calibre_output_range(p_serial, p_from, p_to)` — byte-identical to
  `kirim_line_calibre_output` plus one added `fp.received_date between p_from and p_to`
  predicate.

`report_query_page`/`report_totals`: `state_moykaga_yuborilgan`/`state_moykadan_chiqgan`/
`state_k1`..`state_kn` now source from these two range functions instead of
`kirim_line_state`/`kirim_line_calibre_output` — same column names, so no frontend field
renaming was needed for those 11 fields. `kirim_line_state` stays joined unchanged for the 5
genuinely as-of-now balance columns (`qabul_qilingan`/`omborda_qoldi`/`moyka`/
`xom_jonatilgan`/`olib_ketilgan` — correctly dateless, per the identity
`Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan`) and now doubles as
the source for 2 new trailing lifetime-twin columns:
`state_moykaga_yuborilgan_lifetime`/`state_moykadan_chiqgan_lifetime`.

Both functions change `RETURNS TABLE` shape (2 new trailing columns), so `DROP FUNCTION`
before `CREATE` (Postgres does not allow `CREATE OR REPLACE` to add `OUT` columns to an
existing table-returning function).

**The identity problem, addressed explicitly rather than silently broken:** two identities
depended on Moykaga yuborilgan/Moykadan chiqgan staying lifetime —
`Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan` and
`Moykaga yuborilgan = Moykadan chiqgan + Moykada + Yo'qotish` (the latter already named in
this codebase's own `yoqotish` column comment). Two new default-hidden columns/chips,
`Moykaga yuborilgan (jami)`/`Moykadan chiqgan (jami)`, carry the lifetime figures forward for
checking both identities — sourced from the same already-joined `kirim_line_state` lateral,
zero new reads. A `title` tooltip (`ReportColumnDef.headerNote`, rendered by
`ReportResultsTable.tsx`) on the now-range-scoped column headers points to the `(jami)`
sibling. No lifetime twin for K1-K8/KN (not asked for — `Moykadan chiqgan (jami)` already
covers the aggregate check across all kalibrs combined; per-kalibr lifetime figures are only
needed for loss calculation, handled separately).

The two now-range-scoped state chips (`STATE_COLUMN_CHIPS` in `TotalsStrip.tsx`) are
relabelled from "(joriy)" (current — no longer accurate) to
`"— seriya (davrda)"` (period, but summed per-serial) to disambiguate from the movement
group's own `"(davrda)"` chip for the same metric — same word now on both, since both are
genuinely period-scoped, but the two can still legitimately disagree (movement sums by
filtered row — zero under a non-moyka direction filter; state sums by distinct serial in the
filtered set regardless of direction filter). The five genuinely as-of-now balance chips keep
their "(joriy)" label unchanged, correctly.

### Verification

Dry-run (the full `DROP`/`CREATE` sequence, in a transaction, rolled back) shown to the user
before applying for real, tested against all 5 known cross-month serials in both August and
September ranges. Post-apply, verified against the **entire dataset** (not just those 5
serials):

- **Additivity holds for all 11 range-scoped metrics** (Moykaga yuborilgan, Moykadan
  chiqgan, K1-K8, KN) — month-by-month sums across all 12 months of 2026 exactly equal the
  full-year total, for all 26 distinct serials in the dataset.
- **The 5 balance columns are byte-identical** to an independently recomputed sum via raw
  `kirim_line_state`, full year, all 26 serials.
- **The Qabul qilingan identity holds exactly** (diff = 0) using the new
  `Moykaga yuborilgan (jami)` figure.
- **The Moyka-internal identity does not balance** (diff = −17,830 for the full year) —
  tested as required, confirmed **pre-existing, not a regression**: both sides route through
  functions this change never touched (`kirim_line_state`'s own moyka fields,
  `client_serial_loss_kg`), and migration 0101's own header already flags this exact 3-basis
  divergence (Yakunlash's loss figure vs. Hisobot/Yield's own output basis) as a known,
  out-of-scope nuance predating this task.

Also spot-checked live for serial `110826-002` (P7-S) and all 5 cross-month serials in both
August and September ranges — every value matched the approved plan exactly (e.g. P7-S
September: Moykaga yuborilgan 0, Moykadan chiqgan 70 — was 7,345/7,400 lifetime before).

`npx tsc --noEmit` clean across the whole project after the frontend changes
(`src/lib/reportQuery.ts`, `src/lib/useReportQuery.ts`, `src/lib/reportColumns.ts`,
`src/lib/reportExport.ts`, `src/components/report/TotalsStrip.tsx`,
`src/pages/reports/ReportResultsTable.tsx`, `src/pages/reports/ReportTableRow.tsx`).

### Not in this task (logged, not forgotten)

- Chiqim regrain (per-consumption-event grain instead of per-pallet, departure-date basis
  instead of request-date) — separate, larger task, scoped in the joint investigation.
- Range-scoped Yo'qotish (12th metric) — task after the Chiqim regrain.
- `yield_rows`' first-output-month attribution (a whole different failure mode — inclusion by
  a single `completed_date`, not per-column lifetime leakage) — known issue, logged, not
  touched here.
