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
//     "Harakatlar bo'yicha". This is what every volume column did before
//     today.
//   - state: a serial's own standing balance, summed once per DISTINCT
//     serial (never per row — a serial can own several rows) — "Seriyalar
//     bo'yicha (N ta seriya)". As-of-now, never clipped to the date filter.
//   - both: the column name legitimately means two different numbers —
//     "Moykaga yuborilgan"/"Moykadan chiqgan" are each a real *activity*
//     total (how much moved during this window) AND a real *standing*
//     total (how much of that serial's total ever/still exists) that can
//     diverge (see DECISIONS.md "Hisobot: Moyka rows..."). Renders one chip
//     in EACH group, distinctly labelled ("(davrda)" / "(joriy)") so two
//     different numbers under the same column name are never shown as one
//     unlabelled "Jami."
export type ReportColumnTotalBasis = 'movement' | 'state' | 'both'

export interface ReportColumnDef {
  key: string
  label: string
  kind: ReportColumnKind
  defaultVisible: boolean
  align?: 'right'
  totalBasis?: ReportColumnTotalBasis
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
  // row belonging to that serial. As-of-now, never clipped to the date
  // filter (clipping breaks the reconciliation identity: Qabul qilingan =
  // Omborda qoldi + Moykaga yuborilgan + Xom holda jo'natilgan). All
  // default-hidden — expandable via the column picker, same as Tara/
  // Namlik/SO2 today.
  { key: 'qabul_qilingan', label: 'Qabul qilingan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'omborda_qoldi', label: 'Omborda qoldi, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // 'both': also a real per-row MOVEMENT total (report_totals.total_kg_to_moyka) — see ReportColumnTotalBasis above.
  { key: 'moykaga_yuborilgan', label: 'Moykaga yuborilgan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'both' },
  { key: 'moykada', label: 'Moykada, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // 'both': also a real per-row MOVEMENT total (report_totals.total_kg_from_moyka) — deliberately allowed to diverge from the state figure, see DECISIONS.md.
  { key: 'moykadan_chiqgan', label: 'Moykadan chiqgan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'both' },
  { key: 'xom_jonatilgan', label: "Xom holda jo'natilgan, kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'olib_ketilgan', label: 'Olib ketilgan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
]

export function defaultVisibleColumnKeys(): Set<string> {
  return new Set(REPORT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
}
