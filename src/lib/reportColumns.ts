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
//     today. Always additive across periods (each physical event counted
//     exactly once, in its own period) — safe to stack monthly reports.
//   - state: a serial's own standing balance, summed once per DISTINCT
//     serial (never per row — a serial can own several rows) — "Seriyalar
//     bo'yicha (N ta seriya)". As-of-now, never clipped to the date filter.
//     Only used for genuinely as-of-now balance columns (Qabul qilingan/
//     Omborda qoldi/Moykada/Xom jo'natilgan/Olib ketilgan) — see 2026-09-14
//     note below for why the flow columns don't use this any more.
//   - both: the column name legitimately means two different numbers —
//     a real *activity* total (how much moved during this window,
//     movement-basis) AND a real *standing* total (how much of that
//     serial's total ever/still exists, state-basis).
//   - none: a lifetime per-row figure with no safe strip aggregate at all
//     (2026-09-14) — see that note.
//
// 2026-09-14 (see DECISIONS.md "Hisobot row/column model correction"):
// moykaga_yuborilgan/moykadan_chiqgan went from 'both' to plain 'movement',
// and k1-k8/kn/yoqotish went from 'state' to 'none'. Root cause and the
// general rule this codifies: a strip chip is only valid when its
// arithmetic is additive across the periods a user might stack (e.g. run
// this report for Jan, Feb, Mar and add the three numbers together). A
// state-basis chip on a LIFETIME column fails that test whenever the same
// serial can appear as a row in more than one period's report — which,
// for the moyka/kalibr columns, event kinds like moyka_output/chiqim make
// routine (a serial's output can span several months). A range-scoped
// alternative was evaluated and rejected: it collides exactly with the
// movement chip under every direction where it's well-defined (both sum
// the same underlying rows, just grouped differently), and produces a
// coincidental, meaningless number under a KIRIM-only filter (moyka
// activity happening to fall in the same window as an unrelated arrival
// date). No chip is the only option that's both correct under every
// filter and doesn't just relabel the same collision. The balance columns
// (qabul_qilingan/omborda_qoldi/moykada/xom_jonatilgan/olib_ketilgan) keep
// 'state' — they're irreducibly as-of-now, summing them across stacked
// periods was never a meaningful operation to begin with, so this rule
// doesn't apply to them.
export type ReportColumnTotalBasis = 'movement' | 'state' | 'both' | 'none'

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
  // Default-VISIBLE (2026-09-03, MOYKADAN per-serial rows) — the "how much
  // sent to / received from Moyka" headline figures used to require opening
  // Ustunlar to see at all. Global default (this registry has no per-
  // direction notion of "visible"), same as every other column here — every
  // OTHER column's defaultVisible is unchanged by this migration.
  //
  // 2026-09-14: totalBasis 'both' → 'movement'. The table cell itself stays
  // LIFETIME (kirim_line_state, unchanged) — only the strip chip changed.
  // See ReportColumnTotalBasis above for why the state-basis chip on this
  // column was removed rather than range-scoped.
  { key: 'moykaga_yuborilgan', label: 'Moykaga yuborilgan, kg', kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'movement' },
  { key: 'moykada', label: 'Moykada, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // 2026-09-14: totalBasis 'both' → 'movement', same reasoning as moykaga_yuborilgan above.
  { key: 'moykadan_chiqgan', label: 'Moykadan chiqgan, kg', kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'movement' },
  // Yo'qotish (2026-08-31) — the per-serial REALIZED wash loss, booked only
  // once the serial is closed via Yakunlash (migration 0101's split; NULL,
  // rendered "—", while it is still open, because that gap is still
  // in-process and already shows under Moykada). Sits directly after
  // Moykadan chiqgan because that is the subtraction it is: the four
  // columns close as Moykaga yuborilgan = Moykadan chiqgan + Moykada +
  // Yo'qotish, and its value is sourced from the same basis those two are
  // (see migration 0107) so the row can never fail that arithmetic on
  // screen.
  //
  // 🚩 Default-VISIBLE, deliberately, against this family's own "expandable
  // via the column picker" precedent — the loss figure was asked for on
  // every row without hunting through Ustunlar first. 2026-09-14: totalBasis
  // 'state' → 'none' — the strip chip was removed (same LIFETIME-summed-
  // per-serial problem as the moyka pair above; see ReportColumnTotalBasis).
  // The column itself is untouched, still visible, still per-row lifetime.
  { key: 'yoqotish', label: "Yo'qotish, kg", kind: 'volume', defaultVisible: true, align: 'right', totalBasis: 'none' },
  { key: 'xom_jonatilgan', label: "Xom holda jo'natilgan, kg", kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  { key: 'olib_ketilgan', label: 'Olib ketilgan, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'state' },
  // Output-by-kalibr (2026-08-15 pattern, added 2026-08-29 -- Prompt 6, see
  // DECISIONS.md "Hisobot: output-by-kalibr columns"): a serial's own
  // total-ever-produced-under-this-kalibr figure, repeated on every row that
  // serial owns, one column per kalibr K1-K8 in numeric order, then a
  // separate KN column -- never summed together (KN is a distinct product,
  // not a 9th calibre). All default-hidden, same "expandable via the column
  // picker" precedent as every other serial-state column in this family.
  //
  // 2026-09-14: totalBasis 'state' → 'none' for all nine — same reasoning as
  // Yo'qotish above (a serial's calibre output can span several months, so
  // a LIFETIME state-basis chip isn't additive across stacked periods). The
  // columns themselves are untouched, still lifetime per-row figures.
  { key: 'k1', label: 'K1, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k2', label: 'K2, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k3', label: 'K3, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k4', label: 'K4, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k5', label: 'K5, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k6', label: 'K6, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k7', label: 'K7, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'k8', label: 'K8, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
  { key: 'kn', label: 'KN, kg', kind: 'volume', defaultVisible: false, align: 'right', totalBasis: 'none' },
]

export function defaultVisibleColumnKeys(): Set<string> {
  return new Set(REPORT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
}
