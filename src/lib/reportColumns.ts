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

export interface ReportColumnDef {
  key: string
  label: string
  kind: ReportColumnKind
  defaultVisible: boolean
  align?: 'right'
}

// Order here is display order, left to right. Defaults per the task spec:
// visible = Sana, Seriya, Tur, Yo'nalish, Netto, E'lon qilingan, Hisobiy,
// Holat; hidden-but-expandable = Buyurtmachi, Kalibr, Barcode #2, Tara,
// Moshina, Haydovchi, Namlik, SO2.
export const REPORT_COLUMNS: ReportColumnDef[] = [
  { key: 'direction', label: "Yo'nalish", kind: 'context', defaultVisible: true },
  { key: 'date', label: 'Sana', kind: 'context', defaultVisible: true },
  { key: 'serial', label: 'Seriya', kind: 'context', defaultVisible: true },
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
]

export function defaultVisibleColumnKeys(): Set<string> {
  return new Set(REPORT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
}
