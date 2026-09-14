// Hisobot column registry — the single source of truth for the results
// table's header order, the column picker's option list, and which
// columns the totals strip sums. Before this, the column list was
// duplicated three times (table header, row cells, Excel export header)
// with no shared source and no notion of "which columns are visible" at
// all — this file exists to fix that, not just to add two new columns.
//
// Three kinds, and the kind alone decides totalling behaviour (never
// wired per-column beyond declaring the kind):
//   - context: identity/descriptive fields. Never totalled. Hiding one
//     never removes it as a filter — the filter bar (ReportFilterBar) is
//     wired independently of column visibility, by design.
//   - volume: a kg figure. Every VISIBLE volume column contributes its
//     total to TotalsStrip automatically — see TotalsStrip.tsx's own
//     VOLUME_COLUMN_TOTALS registry, keyed by these same column keys.
//   - measurement: a lab reading (moisture/SO2). Shown when visible,
//     included in row-expand detail either way, but never summed —
//     averaging moisture across unrelated serials is meaningless.
export type ReportColumnKind = 'context' | 'volume' | 'measurement'

// Which totals-strip GROUP a volume column's total belongs to (2026-08-15,
// Moyka rows + serial-state columns). Only meaningful when kind==='volume';
// defaults to 'movement' when omitted (every pre-existing volume column).
//   - movement: the row's own kg, summed across ROWS in the filtered set —
//     "Harakatlar bo'yicha". Always additive across periods (each physical
//     event counted exactly once, in its own period) — safe to stack
//     monthly reports.
//   - state: summed once per DISTINCT serial in the filtered set (never per
//     row — a serial can own several rows) — "Seriyalar bo'yicha (N ta
//     seriya)". Three different kinds of column use this basis, for three
//     different reasons:
//       - the 4 genuinely as-of-now balance columns (Qabul qilingan/Omborda
//         qoldi/Xom jo'natilgan/Olib ketilgan) and the two "(jami)"
//         lifetime-twin columns below — these are LIFETIME figures, and
//         summing once per distinct serial is correct for them because they
//         are never meant to be stacked across periods in the first place
//         (an as-of-now balance has no "Jan + Feb" meaning to preserve).
//       - Moykada (2026-09-14, see note further below) — AS-OF-PERIOD-END
//         (p_to), not as-of-now any more, but the same "never meant to be
//         stacked" reasoning applies: it's a snapshot at a point in time,
//         not a flow, so summing it once per distinct serial for THIS one
//         report's own p_to is meaningful; adding two different reports'
//         Moykada totals together was never a sensible operation, exactly
//         as it wasn't when this column was as-of-now.
//       - moykaga_yuborilgan/moykadan_chiqgan/k1-kn/yoqotish — these are
//         RANGE-SCOPED or period-attributed (2026-09-14, see notes below),
//         so "once per distinct serial in the filtered set" sums exactly
//         the activity/recognition that belongs to the filtered period;
//         additive across stacked periods.
//   - none: currently unused — every volume column now has a safe strip
//     aggregate (movement, or state under one of the three reasons above).
//
// 2026-09-14 (see docs/decisions/0185-...-hisobot-row-column-model-
// correction-ii.md): moykaga_yuborilgan/moykadan_chiqgan/k1-k8/kn are
// RANGE-SCOPED — both the table cell and (for k1-kn) the strip chip clip to
// the report's date filter, via kirim_line_moyka_range/
// kirim_line_calibre_output_range. This re-applies commit 97f5444, which an
// intervening decision (0184) reverted on a misreading of "should be able
// to see their incoming number" as a request for LIFETIME figures — it
// meant the incoming figure FOR THAT PERIOD. The rule, restated plainly:
// the selected date range governs both row selection AND column values,
// for every direction. The one deliberate exception (as of THIS date) was
// the 5 as-of-now balance columns above (and their two "(jami)" twins) —
// genuinely timeless figures with no period meaning, so range-scoping them
// was not just difficult, it was a category error. Moykada has since moved
// out of that exception list — see the 2026-09-14 (later) note below.
//
// Because moykaga_yuborilgan/moykadan_chiqgan's PLAIN column is
// range-scoped, the Qabul qilingan identity (Qabul qilingan = Omborda
// qoldi + Moykaga yuborilgan + Xom jo'natilgan) can no longer be checked
// against it under a date filter — that identity is an inherently lifetime
// statement. A new lifetime-TWIN column pair
// (moykaga_yuborilgan_jami/moykadan_chiqgan_jami, sourced from the
// unchanged kirim_line_state, default-hidden like every other
// reconciliation-only column) exists for exactly that check; the plain
// columns carry a `headerNote` pointing at them. No per-kalibr twin — the
// Moykadan chiqgan (jami) twin already covers the aggregate check across
// all kalibrs combined, same as before.
//
// The strip chip for the plain moykaga_yuborilgan/moykadan_chiqgan pair
// stays REMOVED (totalBasis 'movement', not 'state' or 'both') even though
// range-scoping fixes its additivity — confirmed live it is either exactly
// redundant with the existing movement chip (identical number under any
// filter that includes moyka rows) or actively misleading (a real but
// coincidental number under a KIRIM-only filter, where the movement chip
// correctly reads 0 because no moyka row is in that filtered set — verified
// live: KIRIM-only/September/Global showed movement=0, a naive range-scoped
// state chip would have shown 8,292). k1-k8/kn have no movement-chip
// counterpart to collide with (kalibr output isn't a report_rows `kind`),
// so restoring their state chip is a genuinely new, non-duplicate, now-safe
// number — 'state' restored for those nine.
//
// 2026-09-14 (later same day, see docs/decisions/0186-...-moykada-yoqotish-
// period-scoping.md) — Moykada and Yo'qotish period-scoped, closing the
// invariant gap the note above deliberately left open: a serial's Moykaga
// yuborilgan/Moykadan chiqgan columns were already period-scoped, but
// Moykada stayed as-of-now (kirim_line_state) and Yo'qotish stayed lifetime
// (client_serial_loss_kg) — so a serial with a closed cycle could show 0 in
// Moykada (correctly, nothing is left in the wash) AND a loss figure in
// EVERY period it had any row in, not just the one it closed in (August
// showing the same +55 loss as September for a serial that closed in
// September, alongside Moykada silently reading 0 in both). Fixed by
// making both columns genuinely period-relative instead of leaving one
// lifetime:
//   - Moykada is now AS-OF-PERIOD-END (kirim_line_moyka_asof(serial, p_to))
//     — the in-moyka balance at the close of the report's own p_to, not
//     "right now." A closed cycle (closed_at <= p_to) always reads 0,
//     mirroring kirim_line_state's own closed-cycle override exactly (an
//     earlier version of this fix omitted that override and produced a
//     real invariant violation: a cycle that closed with sent > output
//     showed its residual as "still in Moyka" instead of correctly as a
//     surplus, live-caught for serial 190826-001).
//   - Yo'qotish is now recognized only in the period wash_cycles.closed_at
//     falls in (kirim_line_loss_range(serial, p_from, p_to)) — null
//     ("blank," not zero) in every other period, including every period
//     before closing. Reuses get_client_report's own loss_totals
//     attribution shape (gate on closed_at, then read the full realized
//     figure) rather than inventing a new one.
// Together these hold the invariant: on any row, in any period, either
// Moykada is nonzero (cycle open, or closed but this period predates the
// close) or Yo'qotish is non-blank (cycle closed THIS period) — never both.
// Both are now additive across stacked periods for the same reason as the
// flow columns above (Moykada as a snapshot was already exempt from that
// requirement; Yo'qotish's recognize-once-blank-elsewhere shape makes it a
// genuine partition sum) — Yo'qotish is back to 'state'. No column uses
// 'none' any more (kept in the type for a future column that might need
// it, not because one exists today).
export type ReportColumnTotalBasis = 'movement' | 'state' | 'none'

export interface ReportColumnDef {
  key: string
  label: string
  kind: ReportColumnKind
  defaultVisible: boolean
  align?: 'right'
  totalBasis?: ReportColumnTotalBasis
  // Hover tooltip on the <th> (ReportResultsTable.tsx) — used to flag a
  // meaning change a reader might not expect from the label alone.
  headerNote?: string
}

// Order here is display order, left to right. Defaults per the task spec:
// visible = Sana, Seriya, Tur, Yo'nalish, Netto, E'lon qilingan, Hisobiy,
// Holat; hidden-but-expandable = Buyurtmachi, Kalibr, Barcode #2, Tara,
// Moshina, Haydovchi, Namlik, SO2.
export const REPORT_COLUMNS: ReportColumnDef[] = [
  { key: 'direction', label: "Yo'nalish", kind: 'context', defaultVisible: true },
  { key: 'date', label: 'Sana', kind: 'context', defaultVisible: true },
  { key: 'serial', label: 'Seriya', kind: 'context', defaultVisible: true },
  // Partiya raqami (per-type arrival batch number) -- SPEC.md new
  // subsection, see DECISIONS.md "Partiya raqami". Visible by default and
  // filterable per the task; blank (not 0) on rows with no serial or on
  // opening_stock/internal_reprocess arrivals, same as the underlying
  // column itself.
  { key: 'partiya', label: 'Partiya', kind: 'context', defaultVisible: true },
  { key: 'owner', label: 'Buyurtmachi', kind: 'context', defaultVisible: false },
  { key: 'type', label: 'Tur', kind: 'context', defaultVisible: true },
  { key: 'calibre', label: 'Kalibr', kind: 'context', defaultVisible: false },
  { key: 'barcode2', label: 'Barcode #2', kind: 'context', defaultVisible: false },
  { key: 'netto', label: 'Netto, kg', kind: 'volume', defaultVisible: true, align: 'right' },
  // "Nakladnoy" was considered and rejected: it already means the client's
  // attached waybill PHOTO elsewhere in this app (kirim_orders.doc_photo,
  // shown on the serial passport) — a second, numeric "Nakladnoy" one
  // click away on the same row would mean two different things. Reuses
  // the vocabulary already established for this exact field instead
  // (SPEC.md §2.16's own "Declared" row, §3.2.5's "E'lon qilingan:" line).
  { key: 'declared', label: "E'lon qilingan, kg", kind: 'volume', defaultVisible: true, align: 'right' },
  { key: 'hisobiy', label: 'Hisobiy, kg', kind: 'volume', defaultVisible: true, align: 'right' },
  { key: 'tara', label: 'Tara, kg', kind: 'volume', defaultVisible: false, align: 'right' },
  { key: 'plate', label: 'Moshina', kind: 'context', defaultVisible: false },
  { key: 'driver', label: 'Haydovchi', kind: 'context', defaultVisible: false },
  { key: 'moisture', label: 'Namlik %', kind: 'measurement', defaultVisible: false, align: 'right' },
  { key: 'so2', label: 'SO₂ ppm', kind: 'measurement', defaultVisible: false, align: 'right' },
  { key: 'status', label: 'Holat', kind: 'context', defaultVisible: true },
  // Serial-state columns (2026-08-15, see DECISIONS.md "Hisobot: Moyka
  // rows, direction split, serial-state columns") — every row shows its
  // PARENT SERIAL's own standing breakdown, same value repeated on every
  // row belonging to that serial. qabul_qilingan/omborda_qoldi/
  // xom_jonatilgan/olib_ketilgan are as-of-now, never clipped to the date
  // filter (clipping breaks the reconciliation identity: Qabul qilingan =
  // Omborda qoldi + Moykaga yuborilgan + Xom holda jo'natilgan) — Moykada
  // and Yo'qotish below are period-relative instead, see their own
  // comments. All default-hidden — expandable via the column picker, same
  // as Tara/Namlik/SO2 today.
  { key: 'qabul_qilingan', label: 'Qabul qilingan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'omborda_qoldi', label: 'Omborda qoldi, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // Default-VISIBLE (2026-09-03, MOYKADAN per-serial rows) — the "how much
  // sent to / received from Moyka" headline figures used to require opening
  // Ustunlar to see at all. Global default (this registry has no per-
  // direction notion of "visible"), same as every other column here — every
  // OTHER column's defaultVisible is unchanged by this migration.
  //
  // 2026-09-14: RANGE-SCOPED (re-applies 97f5444; see ReportColumnTotalBasis
  // above) — clipped to the report's date filter, not lifetime any more.
  // totalBasis 'movement': the strip chip stays the existing "(davrda)"
  // movement chip only — a state-basis chip here would now be additive but
  // redundant/misleading, see ReportColumnTotalBasis. Use "Moykaga
  // yuborilgan (jami)" below to check the Qabul qilingan identity.
  { key: 'moykaga_yuborilgan', label: 'Moykaga yuborilgan, kg', kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'movement',
    headerNote: "Davr bo'yicha. Balans tenglamasi (Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan) uchun \"Moykaga yuborilgan (jami)\" ustunidan foydalaning." },
  // Lifetime twin (2026-09-14, re-applies 97f5444) of the column above —
  // default-hidden, like every other reconciliation-only column in this
  // family; sourced from unchanged kirim_line_state. Enable via the column
  // picker to check the Qabul qilingan identity and the Moyka-internal
  // identity now that the plain column is range-scoped.
  { key: 'moykaga_yuborilgan_jami', label: 'Moykaga yuborilgan (jami), kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // 2026-09-14 (later same day, see docs/decisions/0186-...-moykada-
  // yoqotish-period-scoping.md): AS-OF-PERIOD-END now (kirim_line_moyka_
  // asof(serial, p_to)), not as-of-now (kirim_line_state) any more — the
  // in-moyka balance at the close of the report's own p_to. A closed cycle
  // always reads 0 here regardless of p_to (mirrors kirim_line_state's own
  // closed-cycle override), which is what makes the invariant with
  // Yo'qotish below hold: exactly one of the two is ever nonzero/non-blank
  // for a given row in a given period. Strip chip stays ('state' basis) —
  // a snapshot, not a flow, so summing it once per distinct serial for
  // THIS report's own p_to remains the same kind of one-shot figure it
  // always was as as-of-now; stacking it across two different reports'
  // p_to values was never a meaningful operation either way.
  { key: 'moykada', label: 'Moykada, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // 2026-09-14: RANGE-SCOPED, same treatment and same caveat as moykaga_yuborilgan above.
  { key: 'moykadan_chiqgan', label: 'Moykadan chiqgan, kg', kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'movement',
    headerNote: "Davr bo'yicha. \"Moykaga yuborilgan = Moykadan chiqgan + Moykada + Yo'qotish\" tenglamasi uchun \"Moykadan chiqgan (jami)\" ustunidan foydalaning." },
  { key: 'moykadan_chiqgan_jami', label: 'Moykadan chiqgan (jami), kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // Yo'qotish (2026-08-31) — the per-serial REALIZED wash loss, booked only
  // once the serial is closed via Yakunlash (migration 0101's split; NULL,
  // rendered "—", while it is still open, because that gap is still
  // in-process and already shows under Moykada). Sits directly after the
  // Moykadan chiqgan (jami) twin because that is the subtraction it is: the
  // identity is Moykaga yuborilgan (jami) = Moykadan chiqgan (jami) +
  // Moykada + Yo'qotish (the plain Moyka columns are range-scoped, so the
  // (jami) twins are the ones this identity actually closes against).
  //
  // 🚩 Default-VISIBLE, deliberately, against this family's own "expandable
  // via the column picker" precedent — the loss figure was asked for on
  // every row without hunting through Ustunlar first.
  //
  // 2026-09-14 (later same day, see docs/decisions/0186-...-moykada-
  // yoqotish-period-scoping.md): PERIOD-ATTRIBUTED now
  // (kirim_line_loss_range(serial, p_from, p_to)) instead of lifetime
  // (client_serial_loss_kg unconditionally) — non-null ONLY in the period
  // wash_cycles.closed_at falls in, null ("—", not 0) in every other
  // period, including every period before closing. This is what fixes the
  // original bug report: a serial used to show its full loss in EVERY
  // period it had a row in, not just the one it actually closed in. Strip
  // chip restored ('state', was 'none') — confirmed additive (a serial's
  // loss is recognized in exactly one period and blank everywhere else, so
  // summing per period and summing the combined range agree by
  // construction; verified live, see the decision doc).
  { key: 'yoqotish', label: "Yo'qotish, kg", kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'state' },
  { key: 'xom_jonatilgan', label: "Xom holda jo'natilgan, kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'olib_ketilgan', label: 'Olib ketilgan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // Output-by-kalibr (2026-08-15 pattern, added 2026-08-29 -- Prompt 6, see
  // DECISIONS.md "Hisobot: output-by-kalibr columns"): a serial's own
  // kalibr-output figure, repeated on every row that serial owns, one
  // column per kalibr K1-K8 in numeric order, then a separate KN column --
  // never summed together (KN is a distinct product, not a 9th calibre).
  // All default-hidden, same "expandable via the column picker" precedent
  // as every other serial-state column in this family.
  //
  // 2026-09-14: RANGE-SCOPED (re-applies 97f5444) -- was lifetime
  // total-ever-produced, now clipped to the report's date filter via
  // kirim_line_calibre_output_range. totalBasis back to 'state': unlike the
  // moyka pair, there is no movement-chip counterpart for kalibr output (it
  // isn't a report_rows `kind`), so a range-scoped state chip here is a
  // genuinely new, non-duplicate, now-additive number, not a redundant
  // second view of one already on the strip. No per-kalibr lifetime twin --
  // not needed; the Moykadan chiqgan (jami) twin above already covers the
  // aggregate check across all kalibrs combined.
  { key: 'k1', label: 'K1, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k2', label: 'K2, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k3', label: 'K3, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k4', label: 'K4, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k5', label: 'K5, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k6', label: 'K6, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k7', label: 'K7, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'k8', label: 'K8, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'kn', label: 'KN, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // Dispatch-grain kalibr breakdown (2026-09-15, see docs/decisions/0189-
  // ...-chiqim-dispatch-full-detail-and-kalibr-breakdown.md) — what THIS
  // CHIQIM dispatch line physically carried, per kalibr (pallet component
  // only; a chiqim_dispatch is the only row kind that ever populates
  // these). Deliberately SEPARATE keys from k1-kn above, not a reuse: the
  // two are different metrics at different grains (a SERIAL's own
  // wash-output composition vs. what one TRUCK carried), and putting both
  // under one "K4" label/chip would be the exact confusion already
  // rejected for moykaga_yuborilgan (see ReportColumnTotalBasis above) —
  // two numbers meaning different things under one name is a support call
  // waiting to happen. Null (not 0) when the dispatch carried none of that
  // kalibr, computed SQL-side (chiqim_dispatch_calibre_breakdown, nullif).
  // totalBasis 'none' — no strip chip for v1, by explicit decision (same
  // collision risk as the label above; the columns cover the need without
  // it). All default-hidden, same "expandable via the column picker"
  // precedent as every other column in this family.
  { key: 'dispatch_k1', label: "K1 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k2', label: "K2 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k3', label: "K3 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k4', label: "K4 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k5', label: "K5 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k6', label: "K6 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k7', label: "K7 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_k8', label: "K8 (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'dispatch_kn', label: "KN (jo'natma), kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
]

export function defaultVisibleColumnKeys(): Set<string> {
  return new Set(REPORT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
}
