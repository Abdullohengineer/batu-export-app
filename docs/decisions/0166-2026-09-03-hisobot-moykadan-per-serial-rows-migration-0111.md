## 2026-09-03 — Hisobot: MOYKADAN per-serial rows (migration 0111)

**Task brief cited migration "0073" for `report_rows_v2`/Moykadan direction; corrected to
migration 0074.** `docs/DECISIONS.md:4031-4038` ("migration-history audit") records a same-day
renumbering that shifted this file `0073 → 0074`; current `0073` is the unrelated Ombor tara
correction. Used 0074 throughout the diagnosis and this entry.

**Diagnosis first, findings before any code, per instruction.** Feeding chain confirmed:
`report_query_page(text[],...)`/`report_totals(text[],...)` → `report_filtered_rows(text[],...)`
→ view `report_rows_v2` (6-way `UNION ALL`) → `report_moyka_output_rows` for the `moyka_output`
kind — one row per `finished_pallets` entry (one row per pallet; calibre lives on the pallet, so
distinct calibres were already distinct rows, not a separate fan-out layer). Confirmed SQL grain,
not a frontend `flatMap` — zero `.flatMap` in `src/pages/reports`, `ReportResultsTable.tsx` does a
bare `rows.map(...)`.

**The task's headline figures (43,380 kg buggy / 40,200 kg true / ~3,180 kg delta) did not
reproduce against live data via any query path tried**, and are flagged rather than forced to
match: raw per-pallet sum for August 2026 = 64,650 kg; the pre-migration
`report_totals.total_kg_from_moyka` (excludes only `bekor_qilingan`) = 40,190 kg for the same
period (coincidentally already correct — August 2026 has zero `storage_loss`/mint-consumed rows).
Four independent paths converge on **40,190 kg**, not 40,200: `rahbar_dashboard_ledger`'s
`finished.producedKg` and `moyka.calibreKg + moyka.konditirskiyKg` (both 40,190), a hand-written
query applying 0106's exclusion set directly (40,190), and SPEC.md v1.44's own verified identity
("65,652 = 40,190 + 24,030 + 1,432"). Treated 40,190 as the reconciliation target — the 10 kg gap
from the brief's "40,200" is an unexplained approximation in the brief, not a residual found in
the data.

**Exclusion-set gap, confirmed real and in-scope:** `report_totals`'s pre-migration
`total_kg_from_moyka` excluded only `bekor_qilingan` (voided) — not `storage_loss` or
serial_mint_sources-consumed pallets, migration 0106's other two categories
(`rahbar_dashboard_ledger.processed_output`). It happened not to matter for August 2026 (both
categories are empty that period) — exactly the "exclusion that only works because the data
happens not to overlap" pattern this file already named unacceptable for `lab_turnaround_avg`
(2026-08-04 entry). `kirim_line_state`'s `base_pallets` CTE (the *state*/"joriy" chip) already had
the full 3-category exclusion, confirmed by reading its live body — only the *movement*/"davrda"
chip was incomplete.

### The row-grain conflict, raised for explicit approval, resolved by explicit instruction

MOYKADAN's per-pallet row grain is not an oversight — it is a 🔒-locked v1.34 decision
(SPEC.md §3.2.2), deliberately mirroring CHIQIM's own pallet grain ("Barcode #2, wash cycle, and
kalibr are each independent filter dimensions... and only make sense at pallet granularity") and
its own explicit "an event log, not a current-state snapshot" philosophy — confirmed in this
project's own DECISIONS.md 2026-08-15 entry ("Hisobot: Moyka rows, direction split, serial-state
columns"), item 2. The task's "exactly one row per serial per period" requirement reverses that
decision. Presented to the user as three options (keep event rows and fix totals only / add an
additive per-serial summary alongside the existing rows / collapse the row grain as asked,
accepting the tradeoff) — **the user chose the third: collapse the row grain**, explicitly
accepting that Barcode #2/kalibr no longer identify a single MOYKADAN row.

One mitigating finding that made this less costly than first assessed: `report_filtered_rows`'s
pre-existing WHERE clause already gated `moyka_output` rows on calibre_id/barcode2/wash_cycle
being **entirely unset** (`r.kind = 'moyka_output' and p_calibre_id is null and ...`) — setting any
of those three filters already made every `moyka_output` row disappear, not narrow. So those three
filters never meaningfully operated on MOYKADAN at pallet grain either; collapsing to serial grain
does not remove a working filter, it leaves an already-nonfunctional one exactly as
nonfunctional. Also: SPEC.md's own "voided Barcode #2 must remain findable" 🔒 rule (§3.2.2) is
itself struck through and marked SUPERSEDED 2026-07-28 — the re-wash-void mechanism it protected
no longer exists in the current UI, so this collapse does not reopen that specific finding.
`status`/`lab_verdict` **were** real per-pallet narrowing filters (unlike the three above) — these
are preserved by applying them *inside* the new aggregation function, before the `GROUP BY`, not
by the caller's generic post-aggregation clause (which would otherwise silently exclude every row
under a status filter, or silently admit every row under `lab_verdict='tekshirilmagan'`, since
both fields are structurally null on an aggregate row).

### `report_moyka_output_rows_by_serial()` — sync-twin declaration

New function (migration 0111), a thin `GROUP BY serial` wrapper over the existing
`report_moyka_output_rows` view, date-filtered first (so "per period" holds — a static view can't
take `p_from`/`p_to`). Its `qty_kg` ("received from Moyka, final production output only") applies
this exact predicate:

```sql
sum(qty_kg) filter (
  where pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
    and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = barcode2)
)
```

**Sync-twin: `rahbar_dashboard_ledger.processed_output` (migration 0106).** Same three
categories (voided / storage_loss / serial_mint_sources-consumed), same predicate shape 0106's own
header insisted on copying verbatim rather than abstracting ("Exclusion set is `pallet_base`'s,
verbatim, so both ledgers count one set"). If either exclusion set ever gains a category, the
other must gain the identical one in the same commit — the same rule 0106 established for itself,
extended to this new consumer. `report_totals`'s `total_kg_from_moyka` no longer has its own
exclusion logic at all — it sums `qty_kg` straight off the (now pre-filtered) `filtered` CTE, so
there is exactly one place implementing this predicate for Hisobot, not two that could drift.

Not a new balance calculation: a filtered `SUM`/`GROUP BY` over a view that already existed and a
predicate that already existed. `report_moyka_output_rows`, `rahbar_dashboard_ledger`, and
`yield_rows` are all untouched — confirmed unchanged in the applied migration.

### Verified live (not a dry-run figure) — August 2026, `moyka_output` direction only

| Check | Result |
|---|---:|
| Row count / distinct serials | 11 / 11 |
| Row-summed kg | 40,190 |
| `report_totals.total_kg_from_moyka` | 40,190 |
| Serials appearing more than once | 0 |
| MOYKAGA (`moyka_send`) totals, same period | 65,652 kg / 16 rows — unchanged |
| KIRIM totals, same period | 109,257 kg / 14 rows — unchanged |
| `moyka_output` rows with a calibre filter set | 0 (all-or-nothing gate preserved, unchanged) |
| `moyka_output` rows filtered `status='bekor_qilingan'` | 8 serial-rows surface (had a voided pallet that period), kg = 0 each — voided pallets are still findable via the status filter, never counted as received |

First run inside `BEGIN...ROLLBACK` (nothing committed) reproduced the same six figures; applied
for real afterward and re-verified with the same queries against the live (non-rolled-back)
result — identical numbers both times.

### Frontend

`reportColumns.ts`: `moykaga_yuborilgan`/`moykadan_chiqgan` → `defaultVisible: true` (global flag,
this registry has no per-direction notion of default visibility — no other column's default
touched). `reportQuery.ts`: `MoykaOutputReportRow.barcode2`/`calibreId`/`palletStatus`/
`labVerdict`/`moisturePct`/`so2MgKg` are now literal `''`/`null` types, not defensively-coalesced
unions — every `moyka_output` row is an aggregate now, never a single real pallet's data.
`ReportTableRow.tsx`/`ReportRowCard.tsx`/`reportExport.ts`: calibre/barcode2/status cells render a
dash for `moyka_output` instead of attempting a now-nonexistent single-pallet value.
`MoykaOutputRowDetail.tsx` rewritten: shows the period's total received kg instead of one pallet's
lab reading; the per-pallet breakdown (Barcode #2, kalibr, lab result) stays reachable through the
existing "Seriya pasportini ko'rish" button — SPEC.md §3.2.5's serial passport already lists it,
reused rather than rebuilt. `tsc -b --noEmit` and `oxlint` both clean.

**Branch:** `claude/hisobot-moykadan-row-grain-9hwx8o`.
