// §3.2.1-3.2.4 (SPEC.md v1.10 revision) — report-engine shapes + the pure
// DB-row-to-app-row mapping. Filtering, pagination, and totals now live in
// Postgres (report_kirim_rows/report_chiqim_rows/report_rows views +
// report_filtered_rows/report_query_page/report_totals functions — see
// DECISIONS.md "Reporting engine: server-side query" and
// supabase/migrations/*_report_server_side_query.sql) — this file no longer
// filters anything client-side. What's left: the row shapes every UI
// component still renders (unchanged), and mapDbRowToReportRow, the one
// remaining pure function, translating the flat SQL row shape back into the
// KirimReportRow/ChiqimReportRow discriminated union those components
// already expect.
//
// Row model (decided during inspection, not stated literally in the source
// revision — see DECISIONS.md "Reporting query engine" for the full
// reasoning): a KIRIM row is one `kirim_lines` entry (one Barcode #1/serial),
// matching "an arrival line" in the spec text exactly. A CHIQIM row is one
// `finished_pallets` entry (one Barcode #2) — NOT one whole chiqim_request —
// because Barcode #2, wash cycle, and kalibr are all listed as independent
// filter dimensions (§3.2.2) and only make sense at pallet granularity; a
// request-level row would leave those filters ambiguous (which pallet on the
// truck do you mean?). This mirrors KIRIM's own row being at serial (not
// truck) granularity for the identical reason.
//
// Moyka rows + serial-state columns (2026-08-15, see DECISIONS.md "Hisobot:
// Moyka rows, direction split, serial-state columns"): two more row kinds,
// `moyka_send` (one moyka_sends entry, dated by sent_date) and
// `moyka_output` (one finished_pallets entry, dated by received_date) —
// both internal movements, no waybill/gate weighing, so their
// declared/hisobiy/tara fields don't exist at all (not just null — the
// concept doesn't apply, matching the existing chiqim_raw/chiqim_old_kn
// pattern for the same reason). Every row of every kind ALSO carries
// `state`, its parent serial's own as-of-now standing balance (identical
// value repeated on every row of that serial) — read from
// report_query_page's 7 new state_* columns, backed by the new
// kirim_line_state(serial) SQL function (migration 0073). The direction
// filter is now multi-select (6 independently-checkable kinds, not a
// 3-value radio) — see ReportRowKind below.

// One value per report_rows kind (2026-08-15) — replaces the old
// 'kirim' | 'chiqim' | 'both' 3-value radio. The filter is now multi-select
// (see ReportFilterBar.tsx): `directions: []` means no restriction (every
// kind), matching report_totals/report_filtered_rows' own
// `p_directions is null or array_length(...) is null` semantics.
export type ReportRowKind = 'kirim' | 'chiqim' | 'chiqim_raw' | 'chiqim_old_kn' | 'moyka_send' | 'moyka_output'

// The four states named verbatim in §3.2.2. "omborda"/"band_qilingan" have no
// governing event yet (no arrival or dispatch date to filter on) — they
// exist as filter values so a future "stock on hand" saved view (§3.2.6, out
// of scope this prompt) can reuse this same engine, and so a status search
// can surface a pallet that never became a dispatch event. In THIS results
// table (events only, §3.2.4), selecting one of those two returns whatever
// still matches after all other filters — typically nothing, since a
// non-dispatched pallet has no dispatch date to anchor a CHIQIM-direction
// date-range filter on. That's expected, not a bug — see DECISIONS.md.
// 'ishlatilgan' added 2026-08-02 (opening stock Stage 3): a pallet consumed
// into a re-wash mint. Structurally like 'bekor_qilingan' — a terminal state
// with no dispatch event — but semantically its opposite: voided means "this
// never really existed," consumed means "it existed, was produced, and has
// moved on into another serial." Its lineage is on the minted serial's
// passport (Kelib chiqishi).
export type PalletStatusFilter =
  | ''
  | 'omborda'
  | 'band_qilingan'
  | 'jonatilgan'
  | 'bekor_qilingan'
  | 'ishlatilgan'

export type LabVerdictFilter = '' | 'o_tdi' | 'qayta_yuvish' | 'tekshirilmagan'

export interface ReportFilters {
  directions: ReportRowKind[] // [] = no restriction (every kind) — see ReportRowKind above
  from: string // YYYY-MM-DD, inclusive
  to: string // YYYY-MM-DD, inclusive
  ownerId: string // '' = all
  typeId: string // '' = all
  calibreId: string // '' = all — KIRIM rows never match (raw isn't graded, §3.1)
  serial: string // Barcode #1, substring match
  barcode2: string // Barcode #2, substring match (KIRIM rows never match)
  plate: string // substring match
  driver: string // substring match
  labVerdict: LabVerdictFilter
  status: PalletStatusFilter // CHIQIM/pallet rows only
  // Partiya raqami -- exact match, '' = no filter. Text (not number) since
  // it's a controlled text input, same convention as serial/barcode2 below;
  // parsed to an integer (or null) only when building the RPC params.
  partiya: string
}

export function defaultReportFilters(from: string, to: string): ReportFilters {
  return {
    directions: [],
    from,
    to,
    ownerId: '',
    typeId: '',
    calibreId: '',
    serial: '',
    barcode2: '',
    plate: '',
    driver: '',
    labVerdict: '',
    status: '',
    partiya: '',
  }
}

export type DateBasisSource = 'gate_stage1' | 'order_date' | 'gate_stage2' | 'sent_date' | 'received_date' | null

// A serial's own as-of-now standing balance (2026-08-15) — repeated
// identically on every row belonging to that serial, regardless of row
// kind. Never clipped to the report's date filter (see DECISIONS.md —
// clipping would break the Qabul qilingan = Omborda qoldi + Moykaga
// yuborilgan + Xom holda jo'natilgan identity).
//
// "Yo'qotish" was excluded here from 2026-08-15 to 2026-08-31 on the
// grounds that "no canonical per-serial loss-in-kg figure exists yet."
// Migration 0101 (Yakunlash, 2026-08-29) created one — client_serial_loss_kg
// — so the field is now carried; see `yoqotish` below.
export interface SerialState {
  qabulQilingan: number
  ombordaQoldi: number
  moykagaYuborilgan: number
  moykada: number
  moykadanChiqgan: number
  xomJonatilgan: number
  olibKetilgan: number
  // Realized wash loss for this serial (2026-08-31), from
  // client_serial_loss_kg via report_query_page.state_yoqotish. null while
  // the serial's wash cycle is still open — nothing is booked yet and the
  // gap reads as `moykada` instead (migration 0101's realized/unrealized
  // split). Signed once booked, same convention as every other loss figure
  // in this app: positive = loss, negative = surplus (render via
  // formatLoss.ts, never bare).
  yoqotish: number | null
  // Output-by-kalibr (2026-08-29, Prompt 6) -- total EVER produced under
  // that kalibr for this serial (available + already-dispatched, i.e. gross
  // production — see migration 0098's own header for the formula
  // reconciliation). k1..k8 in numeric order, kn (Konditirskiy) separate,
  // matching the calibre picker's own K1-K8/KN convention.
  k1: number
  k2: number
  k3: number
  k4: number
  k5: number
  k6: number
  k7: number
  k8: number
  kn: number
}

export interface KirimReportRow {
  kind: 'kirim'
  key: string // serial — stable row key
  serial: string
  orderId: string
  typeId: string
  partiyaNo: number | null // Partiya raqami — per-type arrival batch number; null for opening_stock/internal_reprocess (never arrived on a truck)
  ownerId: string
  plate: string
  driver: string
  dateBasis: string | null // §3.2.3: arrival date — gate stage 1, else order_date
  dateBasisSource: DateBasisSource
  declaredQty: number
  effectiveQtyKg: number
  // "Hisobiy" (2026-08-15) -- least(netto, declared) per row, computed
  // here, never stored, never the accounting basis. Only ever meaningful
  // on kirim rows (declaredQty is a KIRIM-only concept -- see
  // ChiqimReportRow/RawDispatchReportRow/OldKnReportRow, none of which
  // carry a declaredQty field at all), so this lives only on
  // KirimReportRow, not as a nullable field on the shared union -- a
  // caller can't accidentally read it off a row kind where it doesn't
  // exist. See DECISIONS.md "Hisobot: E'lon qilingan + Hisobiy columns."
  hisobiyKg: number
  provisional: boolean
  truckVarianceDiffKg: number | null
  truckVarianceDiffPct: number | null
  provisionalVarianceFlag: boolean
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  kirimMoisturePct: number | null // lab_results scope=kirim, descriptive only, no verdict (§5.5.2)
  kirimSo2MgKg: number | null
  boxMassKg: number | null // Tara — storage_intake.box_mass_kg for this serial, entered by Ombor at intake
  state: SerialState
}

export interface ChiqimReportRow {
  kind: 'chiqim'
  key: string // barcode2 — stable row key
  barcode2: string
  serial: string // parent serial
  typeId: string
  partiyaNo: number | null
  calibreId: string
  ownerId: string
  requestId: string
  plate: string
  driver: string
  weightKg: number
  washCycle: number
  palletStatus: Exclude<PalletStatusFilter, ''>
  dateBasis: string | null // §3.2.3: dispatch date (gate stage 2 completed_at) — null unless actually dispatched
  labVerdict: 'o_tdi' | 'qayta_yuvish' | null // null = tekshirilmagan (untested)
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  moisturePct: number | null
  so2MgKg: number | null
  voidInfo: VoidedBarcodeInfo | null // populated only when palletStatus === 'bekor_qilingan'
  boxMassKg: null // Tara — finished goods never carry their own box mass (already deducted upstream at the raw stage); always null, kept here so ReportTableRow can read row.boxMassKg without a kind check
  state: SerialState
}

// Raw dispatch (2026-07-31) — one row per raw_dispatch_lines entry, the
// third report_rows kind alongside kirim/chiqim (see DECISIONS.md "Raw
// dispatch"). No calibre/barcode2/wash cycle/lab verdict — a raw exit was
// never graded or lab-tested, it's a plain kg event like a KIRIM line, just
// on the CHIQIM (out) side. weightKg deliberately named to match
// ChiqimReportRow's own field (net_kg here) so the shared
// `row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg` ternary used
// across the report UI keeps working unchanged for both non-kirim kinds.
export interface RawDispatchReportRow {
  kind: 'chiqim_raw'
  key: string // raw_dispatch_lines.id — stable row key
  serial: string
  typeId: string
  partiyaNo: number | null
  ownerId: string
  requestId: string
  plate: string
  driver: string
  weightKg: number // net_kg (weight − box mass), Ombor's own entry, authoritative immediately
  boxMassKg: number | null
  dateBasis: string | null // §3.2.3: chiqim_requests.request_date, same basis as pallet rows
  palletStatus: 'jonatilgan' // raw_dispatch_lines only exists once committed at Ombor's finish click — always departed
  state: SerialState
}

// Old-KN collections (2026-08-05) -- the fourth report_rows kind, mirroring
// RawDispatchReportRow's shape exactly: no serial (old-KN has none), no
// calibre/barcode2/wash cycle/lab verdict, no box mass. weightKg named to
// match the other non-kirim kinds so the shared
// `row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg` ternary keeps
// working unchanged for all three.
export interface OldKnReportRow {
  kind: 'chiqim_old_kn'
  key: string // old_kn_collections.id -- stable row key
  typeId: string
  partiyaNo: null // old-KN has no serial at all -- genuinely inapplicable, not just unassigned, same as state: null below
  ownerId: string // sourced from old_kn_pools, not chiqim_requests -- see DECISIONS.md "Old-KN reporting"
  requestId: string
  plate: string
  driver: string
  weightKg: number // old_kn_collections.collected_kg
  boxMassKg: null // old-KN has no box mass concept
  dateBasis: string | null // §3.2.3: chiqim_requests.request_date, same basis as raw dispatch
  palletStatus: 'jonatilgan' // a collection row only exists once committed -- always departed
  // old-KN pool collections have no serial/order lineage at all (confirmed
  // in report_old_kn_rows' own SQL: serial is a NULL literal) — state is
  // genuinely inapplicable here, not just zero, matching "blank not zero."
  state: null
}

// MOYKAGA (2026-08-15) — one moyka_sends entry, dated by sent_date.
// Internal movement, no waybill/gate weighing at all — plate/driver are
// structurally absent (always null), not just empty, matching
// OldKnReportRow's own boxMassKg:null convention for the same reason.
export interface MoykaSendReportRow {
  kind: 'moyka_send'
  key: string // moyka_sends.id — stable row key
  serial: string
  orderId: string
  typeId: string
  partiyaNo: number | null
  ownerId: string
  plate: null
  driver: null
  weightKg: number // moyka_sends.qty_kg
  boxMassKg: null
  dateBasis: string | null // §3.2.3 extended: sent_date
  palletStatus: null // no pallet concept for a send event
  state: SerialState
}

// MOYKADAN (2026-08-15; collapsed to one row per serial per period,
// 2026-09-03 — see DECISIONS.md "Hisobot: MOYKADAN per-serial rows").
// Reverses the original "one finished_pallets entry per row" grain
// (deliberately, on explicit instruction, against v1.34's own 🔒 decision —
// see the migration 0111 header for the full tradeoff): a row is now one
// SERIAL's Moyka-output activity for the filtered period, weightKg is the
// 0106-exclusion-filtered ("received from Moyka, final production output
// only") sum across that serial's pallets in the period. barcode2/calibreId
// are structurally inapplicable at this grain (a serial can own several
// pallets across several calibres) — always blank, not a missing value; use
// the serial passport (§3.2.5) for the per-pallet breakdown. Same for
// palletStatus/labVerdict/moisturePct/so2MgKg — a serial's pallets can carry
// mixed statuses/verdicts, so there is no single value to show here.
export interface MoykaOutputReportRow {
  kind: 'moyka_output'
  key: string // 'moyka-output-serial-<serial>-<from>-<to>' — period-scoped, not bare barcode2 any more
  serial: string
  barcode2: '' // always empty — genuinely inapplicable at serial grain, not a missing value
  orderId: string
  requestId: string
  typeId: string
  partiyaNo: number | null
  calibreId: '' // always empty — see barcode2 above
  ownerId: string
  plate: null
  driver: null
  weightKg: number // sum of finished_pallets.weight_kg for this serial+period, 0106-exclusion-filtered
  boxMassKg: null
  dateBasis: string | null // §3.2.3 extended: most recent received_date in the period
  palletStatus: null // always null — a serial's pallets can carry mixed statuses, no single value applies
  labVerdict: null // always null — same reason
  moisturePct: null
  so2MgKg: null
  state: SerialState
}

export type ReportRow =
  | KirimReportRow
  | ChiqimReportRow
  | RawDispatchReportRow
  | OldKnReportRow
  | MoykaSendReportRow
  | MoykaOutputReportRow

// §3.2.2 🔒 "a voided Barcode #2 must remain findable" — a voided pallet's
// cycle was, by construction, the ACTIVE cycle at the moment it was voided
// (only the active cycle can ever be re-washed — see activeCycles.ts), so
// its successor is always exactly `voidedCycle + 1`, never ambiguous about
// WHICH later cycle to look at. What IS genuinely plural: that successor
// cycle can produce more than one new pallet (the daily receipt form is
// "one pallet per save", §5.3) or, if the re-wash send hasn't been received
// back into Moyka output yet, zero. successorBarcodes lists whatever exists;
// the caller renders "yangi barkod" for exactly one, "yangi barkodlar" for
// several, and a "hali chiqarilmagan" note for zero — see DECISIONS.md.
export interface VoidedBarcodeInfo {
  voidedCycle: number
  successorCycle: number
  successorBarcodes: string[]
}

// taraIn/taraOut, not one merged `tara` (2026-07-31, see DECISIONS.md "Raw
// dispatch"): KIRIM tara (boxes coming in) and raw-dispatch tara (boxes
// going out) are unrelated quantities that happen to share a column name —
// summing them into one figure on a "both directions" view would read as a
// real number while meaning nothing. Split, so there is never an ambiguous
// total regardless of which direction is selected.
export interface ReportTotals {
  kgIn: number
  kgOut: number
  net: number
  taraIn: number
  taraOut: number
  // "E'lon qilingan"/"Hisobiy" totals (2026-08-15) -- unlike kgIn/kgOut,
  // these are KIRIM-only concepts by construction (declared_qty is
  // NULL::numeric on every non-kirim report_rows kind), so there is no
  // analogous "out" side to split against, unlike taraIn/taraOut.
  totalDeclared: number
  totalHisobiy: number
  // Moyka movement totals (2026-08-15) -- row sums for the 2 new kinds,
  // deliberately NOT folded into kgIn/kgOut/net: internal movement, never
  // left the factory, same reasoning as the blank waybill fields (approved
  // explicitly — see DECISIONS.md). Labelled "(davrda)" on screen to stay
  // distinct from the same-named state total below.
  totalToMoyka: number
  totalFromMoyka: number
  // Serial-state totals (2026-08-15) -- summed once per DISTINCT serial in
  // the filtered set, never once per row (a serial can own several rows —
  // this is "the trap" the column design explicitly guards against).
  // stateSerialCount is how many distinct serials that is — shown in the
  // "Seriyalar bo'yicha (N ta seriya)" group label so a reader can never
  // mistake it for a row count. totalToMoyka/totalFromMoyka above have a
  // "(joriy)"-labelled twin here (stateMoykagaYuborilgan/
  // stateMoykadanChiqgan) that can legitimately read a different number —
  // see DECISIONS.md "Hisobot: Moyka rows...".
  stateSerialCount: number
  stateQabulQilingan: number
  stateOmbordaQoldi: number
  stateMoykagaYuborilgan: number
  stateMoykada: number
  stateMoykadanChiqgan: number
  stateXomJonatilgan: number
  stateOlibKetilgan: number
  // Realized wash loss (2026-08-31) — summed once per distinct serial on the
  // same basis as the 7 above. Open serials contribute nothing (SQL's sum()
  // skips their NULL), so this is total BOOKED loss for the filtered set,
  // never a to-date guess at serials still in the wash.
  stateYoqotish: number
  // Output-by-kalibr totals (2026-08-29) -- same distinct-serial summing
  // basis as the 7 above, never the KN column folded into K1-K8's own sums.
  stateK1: number
  stateK2: number
  stateK3: number
  stateK4: number
  stateK5: number
  stateK6: number
  stateK7: number
  stateK8: number
  stateKn: number
}

// Which real-world date each kind is governed by (§3.2.3, extended
// 2026-08-15 to the two Moyka kinds — same rule, not a new mechanism: each
// row is dated by its own event). chiqim/chiqim_raw/chiqim_old_kn all read
// the identical chiqim_requests.request_date column, so they share one
// label here.
const KIND_DATE_BASIS_LABEL: Record<ReportRowKind, string> = {
  kirim: 'kelish (buyurtma sanasi)',
  chiqim: "so'rov sanasi",
  chiqim_raw: "so'rov sanasi",
  chiqim_old_kn: "so'rov sanasi",
  moyka_send: 'Moykaga yuborilgan sana',
  moyka_output: 'Moykadan chiqqan sana',
}

// §3.2.3 🔒 date basis label, shown on screen and in exports — printed
// exactly once per direction selection, never silently varying per row.
// Extended 2026-08-15 for the multi-select direction filter: names the
// single basis when every checked kind shares one, otherwise falls back to
// the same "each row on its own event" wording the old 'both' value used —
// "two people producing two different numbers from the same screen" is
// exactly what this label exists to prevent, whether 2 kinds are checked
// or 6.
export function dateBasisLabel(directions: ReportRowKind[]): string {
  if (directions.length === 0) {
    return "Sana asosi: har bir qator o'zining hodisasi bo'yicha (kirim — kelish, chiqim — so'rov, moykaga/moykadan — o'z sanasi)"
  }
  const distinctLabels = [...new Set(directions.map((d) => KIND_DATE_BASIS_LABEL[d]))]
  if (distinctLabels.length === 1) {
    return `Sana asosi: ${distinctLabels[0]}`
  }
  return "Sana asosi: har bir qator o'zining hodisasi bo'yicha"
}

export const WEIGHT_BASIS_LABEL = "Og'irlik asosi: effective_qty (darvoza netto / oraliq qiymat, §2.16)"

// The flat shape report_query_page actually returns over the wire. Numeric
// columns are wrapped in Number(...) defensively in the mapper below —
// PostgREST's `numeric` serialization differs between plain table reads and
// RPC/function results, and this avoids silently doing string concatenation
// instead of arithmetic if a given code path happens to come back as text.
export interface ReportDbRow {
  kind: 'kirim' | 'chiqim' | 'chiqim_raw' | 'chiqim_old_kn' | 'moyka_send' | 'moyka_output'
  row_key: string
  serial: string | null
  barcode2: string | null
  order_id: string | null
  request_id: string | null
  owner_id: string
  type_id: string
  partiya_no: number | string | null
  calibre_id: string | null
  plate: string | null
  driver: string | null
  date_basis: string | null
  date_basis_source: DateBasisSource
  qty_kg: number | string
  provisional: boolean
  declared_qty: number | string | null
  truck_variance_diff_kg: number | string | null
  truck_variance_diff_pct: number | string | null
  provisional_variance_flag: boolean
  wash_cycle: number | string | null
  pallet_status: Exclude<PalletStatusFilter, ''> | null
  lab_verdict: 'o_tdi' | 'qayta_yuvish' | null
  target_moisture_pct: number | string | null
  target_so2_mg_kg: number | string | null
  moisture_pct: number | string | null
  so2_mg_kg: number | string | null
  void_successor_barcodes: string[] | null
  box_mass_kg: number | string | null
  // Serial-state columns (2026-08-15, report_query_page only — NOT on the
  // bare report_chiqim_rows table read fetchVoidedBarcodeMatch uses, see
  // useReportQuery.ts). All 7 come back together as NULL when the row has
  // no serial (chiqim_old_kn) — mapState below checks one as a proxy for
  // all.
  state_qabul_qilingan?: number | string | null
  state_omborda_qoldi?: number | string | null
  state_moykaga_yuborilgan?: number | string | null
  state_moykada?: number | string | null
  state_moykadan_chiqgan?: number | string | null
  state_xom_jonatilgan?: number | string | null
  state_olib_ketilgan?: number | string | null
  // Yo'qotish (2026-08-31). Unlike every other state_* column this one is
  // legitimately NULL on a row that HAS a serial (an open wash cycle), so it
  // can never serve as the null proxy the 7 above share — and it must not be
  // read through it either: mapState nulls the whole object off
  // state_qabul_qilingan, then maps this field on its own.
  state_yoqotish?: number | string | null
  // Output-by-kalibr (2026-08-29) -- same "comes back together, null proxy"
  // shape as the 7 columns above, from kirim_line_calibre_output (0098).
  state_k1?: number | string | null
  state_k2?: number | string | null
  state_k3?: number | string | null
  state_k4?: number | string | null
  state_k5?: number | string | null
  state_k6?: number | string | null
  state_k7?: number | string | null
  state_k8?: number | string | null
  state_kn?: number | string | null
}

function num(v: number | string | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

function mapState(row: ReportDbRow): SerialState | null {
  if (row.state_qabul_qilingan === null || row.state_qabul_qilingan === undefined) return null
  return {
    qabulQilingan: Number(row.state_qabul_qilingan),
    ombordaQoldi: Number(row.state_omborda_qoldi),
    moykagaYuborilgan: Number(row.state_moykaga_yuborilgan),
    moykada: Number(row.state_moykada),
    moykadanChiqgan: Number(row.state_moykadan_chiqgan),
    xomJonatilgan: Number(row.state_xom_jonatilgan),
    olibKetilgan: Number(row.state_olib_ketilgan),
    // num(), not Number(): a null here means "not booked yet", which must
    // survive as null — Number(null) would silently render it as 0 kg lost.
    yoqotish: num(row.state_yoqotish),
    k1: Number(row.state_k1),
    k2: Number(row.state_k2),
    k3: Number(row.state_k3),
    k4: Number(row.state_k4),
    k5: Number(row.state_k5),
    k6: Number(row.state_k6),
    k7: Number(row.state_k7),
    k8: Number(row.state_k8),
    kn: Number(row.state_kn),
  }
}

export function mapDbRowToReportRow(row: ReportDbRow): ReportRow {
  if (row.kind === 'kirim') {
    const declaredQty = num(row.declared_qty) ?? 0
    const effectiveQtyKg = Number(row.qty_kg)
    // Every kirim_lines row has a real serial by construction — state is
    // never genuinely inapplicable here, unlike chiqim_old_kn (confirmed
    // via report_kirim_rows' own SQL: serial is never null).
    return {
      kind: 'kirim',
      key: row.row_key,
      serial: row.serial ?? '',
      orderId: row.order_id ?? '',
      typeId: row.type_id,
      partiyaNo: num(row.partiya_no),
      ownerId: row.owner_id,
      plate: row.plate ?? '',
      driver: row.driver ?? '',
      dateBasis: row.date_basis,
      dateBasisSource: row.date_basis_source,
      declaredQty,
      effectiveQtyKg,
      hisobiyKg: Math.min(effectiveQtyKg, declaredQty),
      provisional: row.provisional,
      truckVarianceDiffKg: num(row.truck_variance_diff_kg),
      truckVarianceDiffPct: num(row.truck_variance_diff_pct),
      provisionalVarianceFlag: row.provisional_variance_flag,
      targetMoisturePct: num(row.target_moisture_pct),
      targetSo2MgKg: num(row.target_so2_mg_kg),
      kirimMoisturePct: num(row.moisture_pct),
      kirimSo2MgKg: num(row.so2_mg_kg),
      boxMassKg: num(row.box_mass_kg),
      state: mapState(row) ?? zeroState(),
    }
  }

  if (row.kind === 'chiqim_raw') {
    return {
      kind: 'chiqim_raw',
      key: row.row_key,
      serial: row.serial ?? '',
      typeId: row.type_id,
      partiyaNo: num(row.partiya_no),
      ownerId: row.owner_id,
      requestId: row.request_id ?? '',
      plate: row.plate ?? '',
      driver: row.driver ?? '',
      weightKg: Number(row.qty_kg),
      boxMassKg: num(row.box_mass_kg),
      dateBasis: row.date_basis,
      palletStatus: 'jonatilgan',
      state: mapState(row) ?? zeroState(),
    }
  }

  if (row.kind === 'chiqim_old_kn') {
    return {
      kind: 'chiqim_old_kn',
      key: row.row_key,
      typeId: row.type_id,
      partiyaNo: null,
      ownerId: row.owner_id,
      requestId: row.request_id ?? '',
      plate: row.plate ?? '',
      driver: row.driver ?? '',
      weightKg: Number(row.qty_kg),
      boxMassKg: null,
      dateBasis: row.date_basis,
      palletStatus: 'jonatilgan',
      state: null, // no serial, genuinely inapplicable — see OldKnReportRow's own comment
    }
  }

  if (row.kind === 'moyka_send') {
    return {
      kind: 'moyka_send',
      key: row.row_key,
      serial: row.serial ?? '',
      orderId: row.order_id ?? '',
      typeId: row.type_id,
      partiyaNo: num(row.partiya_no),
      ownerId: row.owner_id,
      plate: null,
      driver: null,
      weightKg: Number(row.qty_kg),
      boxMassKg: null,
      dateBasis: row.date_basis,
      palletStatus: null,
      state: mapState(row) ?? zeroState(),
    }
  }

  if (row.kind === 'moyka_output') {
    // Per-serial aggregate (2026-09-03) — the SQL side (migration 0111)
    // always returns barcode2/calibre_id/pallet_status/lab_verdict/
    // moisture_pct/so2_mg_kg as null for this kind now, so these fields are
    // literal, not defensively coalesced — see MoykaOutputReportRow's own
    // comment for why.
    return {
      kind: 'moyka_output',
      key: row.row_key,
      serial: row.serial ?? '',
      barcode2: '',
      orderId: row.order_id ?? '',
      requestId: row.request_id ?? '',
      typeId: row.type_id,
      partiyaNo: num(row.partiya_no),
      calibreId: '',
      ownerId: row.owner_id,
      plate: null,
      driver: null,
      weightKg: Number(row.qty_kg),
      boxMassKg: null,
      dateBasis: row.date_basis,
      palletStatus: null,
      labVerdict: null,
      moisturePct: null,
      so2MgKg: null,
      state: mapState(row) ?? zeroState(),
    }
  }

  const washCycle = num(row.wash_cycle) ?? 1
  const palletStatus = row.pallet_status ?? 'omborda'
  const voidInfo: VoidedBarcodeInfo | null =
    palletStatus === 'bekor_qilingan'
      ? { voidedCycle: washCycle, successorCycle: washCycle + 1, successorBarcodes: row.void_successor_barcodes ?? [] }
      : null

  return {
    kind: 'chiqim',
    key: row.row_key,
    barcode2: row.barcode2 ?? '',
    serial: row.serial ?? '',
    typeId: row.type_id,
    partiyaNo: num(row.partiya_no),
    calibreId: row.calibre_id ?? '',
    ownerId: row.owner_id,
    requestId: row.request_id ?? '',
    plate: row.plate ?? '',
    driver: row.driver ?? '',
    weightKg: Number(row.qty_kg),
    washCycle,
    palletStatus,
    dateBasis: row.date_basis,
    labVerdict: row.lab_verdict,
    targetMoisturePct: num(row.target_moisture_pct),
    targetSo2MgKg: num(row.target_so2_mg_kg),
    moisturePct: num(row.moisture_pct),
    so2MgKg: num(row.so2_mg_kg),
    voidInfo,
    boxMassKg: null,
    state: mapState(row) ?? zeroState(),
  }
}

// Defensive fallback only — every kind that calls this always has a real
// serial (confirmed per-kind above), so report_query_page's LEFT JOIN
// LATERAL kirim_line_state(...) should never actually return null for
// these rows. Falls back to zero rather than throwing if some future edge
// case does produce null, rather than crashing the whole report render —
// deliberately NOT used for chiqim_old_kn, whose `state: null` is a real,
// permanent "inapplicable," not a defensive fallback.
function zeroState(): SerialState {
  return {
    qabulQilingan: 0,
    ombordaQoldi: 0,
    moykagaYuborilgan: 0,
    moykada: 0,
    moykadanChiqgan: 0,
    xomJonatilgan: 0,
    olibKetilgan: 0,
    // null, not 0: this fallback stands in for "the state row is missing",
    // and 0 would assert that nothing was lost. null renders "—", the same
    // as a serial whose loss simply is not booked yet.
    yoqotish: null,
    k1: 0,
    k2: 0,
    k3: 0,
    k4: 0,
    k5: 0,
    k6: 0,
    k7: 0,
    k8: 0,
    kn: 0,
  }
}
