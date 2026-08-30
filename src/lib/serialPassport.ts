import { supabase } from './supabase'

// §3.2.5 Serial passport — the full lifecycle of one parent serial, reached
// as a drill-down from any Hisobot row (KIRIM or CHIQIM), resolving to that
// row's parent serial. Reads underlying records directly via the
// get_serial_passport RPC (supabase/migrations/0027_serial_passport.sql) —
// NOT through Ombor's finished-goods view (useMoykaOutput.ts), which
// SPEC.md §5.3's own v1.10 amendment explicitly flags as active-cycle-only
// and explicitly excludes the passport from that limitation. All cycles are
// visible here, including voided pallets and what replaced them.
//
// The RPC reuses report_kirim_rows/report_chiqim_rows for effective_qty and
// pallet_status/void-successor derivation (see DECISIONS.md "Serial
// passport") rather than a third implementation of either — this means a
// TEST--prefixed serial's passport comes back mostly empty (those two views
// exclude TEST- plates). Harmless in production: a TEST- serial never
// appears in Hisobot, so there is no row to reach its passport from.

export interface PassportOrder {
  orderId: string
  ownerId: string
  ownerName: string
  plate: string
  driver: string
  orderDate: string
  declaredQty: number
  declaredTotal: number | null
  isMultiLine: boolean
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  typeId: string
  // Partiya raqami -- per-type arrival batch number. Null for opening_stock/
  // internal_reprocess orders (isOldStock/isMinted below) — they never
  // arrived on a truck, see DECISIONS.md "Partiya raqami".
  partiyaNo: number | null
  // The nakladnoy attached on the KIRIM form ("Mijoz nakladnoyasini
  // biriktirish") -- captured since day one, only added here (§3.2.5
  // passport improvements task) once confirmed the passport was the one
  // place not showing it.
  docPhoto: string | null
  // Opening stock, Stage 2 (2026-08-02) -- true for a seeded old-washed/
  // old-raw serial's own order row. The original inspect-and-plan task
  // named the passport alongside qoldig'i/client report for "reading as
  // distinct from current stock"; this is that wiring.
  isOldStock: boolean
  // Stage 3 -- origin='internal_reprocess': this serial was MINTED from
  // consumed pallets (or, later, a Rezka weight draw), not delivered. Its
  // Buyurtma/Darvoza sections are near-empty by design; mintOrigin below
  // is where its actual beginning is recorded.
  isMinted: boolean
}

// Stage 3 -- what a minted serial was born from. Null for every ordinary
// delivered serial.
export interface PassportMintSourcePallet {
  barcode2: string
  bookWeightKg: number
  calibreId: string
  sourceSerial: string
}

export interface PassportMintOrigin {
  palletCount: number
  // Sum of the consumed pallets' BOOK weights -- year-old estimates.
  bookTotalKg: number
  // Weight-pool path (Rezka); always 0 for a Stage 3 old-stock re-wash.
  poolDrawKg: number
  // What actually went to Moyka, off a real scale.
  sentWeighedKg: number
  pallets: PassportMintSourcePallet[]
}

export interface PassportNote {
  id: string
  body: string
  createdAt: string
  authorName: string | null
}

export interface PassportEffectiveQty {
  valueKg: number
  provisional: boolean
  truckVarianceDiffKg: number | null
  truckVarianceDiffPct: number | null
}

export interface PassportGate {
  gruzhenyKg: number | null
  pustoyKg: number | null
  netKg: number | null
  stage1CompletedAt: string | null
  stage1CreatedByName: string | null
  stage1PlatePhoto: string | null
  stage1ScalePhoto: string | null
  stage2CompletedAt: string | null
  stage2CreatedByName: string | null
  stage2ScalePhoto: string | null
  departureDocPhoto: string | null
}

export interface PassportIntake {
  actualQty: number
  confirmedAt: string
  confirmedByName: string | null
  barcode1: string | null
  pilePhoto: string | null
  komment: string | null
  boxMassKg: number | null
}

export interface PassportKirimLab {
  sampleDate: string
  moisturePct: number
  so2MgKg: number | null
  testedByName: string | null
  samplePhoto: string | null
  note: string | null
}

export interface PassportCyclePallet {
  barcode2: string
  calibreId: string
  weightKg: number
  palletStatus: 'omborda' | 'band_qilingan' | 'jonatilgan' | 'bekor_qilingan' | 'saqlashda_yoqolgan' | 'ishlatilgan'
  voidSuccessorBarcodes: string[] | null
}

export interface PassportCycleLab {
  verdict: 'o_tdi' | 'qayta_yuvish'
  moisturePct: number
  so2MgKg: number | null
  sampleDate: string
  testedByName: string | null
  samplePhoto: string | null
  note: string | null
}

// Moyka loss becomes live (DECISIONS.md "Moyka loss becomes live; remove
// Tugallash") — status/finalLossPct (a locked, Tugallash-only figure)
// replaced with two always-live numbers: inMoykaKg (floored, physical
// "still sitting in Moyka") and lossKg (signed, sent - output).
//
// AMENDED 2026-08-29 (Prompt 10, Yakunlash -- see DECISIONS.md "Serial
// close-out (Yakunlash)"): the gap those two numbers describe now splits on
// closedAt. Open (closedAt null): inMoykaKg is the live floored gap,
// lossKg is null (unrealized -- nothing booked yet). Closed: inMoykaKg is
// 0, lossKg is the signed booked figure. isRealized === (closedAt !== null),
// carried separately so the UI doesn't have to re-derive it from closedAt.
export interface PassportCycle {
  inMoykaKg: number
  lossKg: number | null
  isRealized: boolean
  closedAt: string | null
  sentKg: number
  pallets: PassportCyclePallet[]
  lab: PassportCycleLab | null
}

export interface PassportDispatchPallet {
  barcode2: string
  calibreId: string
  weightKg: number
  loadedAt: string
}

// CHIQIM truck type (2026-08-30, see DECISIONS.md "CHIQIM truck type:
// Fura"). A fura is never weighed at the gate, so `gate` is null throughout
// for one — permanently and by design, not pending. `loadedKg` (Ombor's own
// loaded total for the whole trip, from chiqim_request_loaded_kg) is what
// the passport shows in its place, and `departedAt` is the canonical
// departure moment under either truck type (gate stage 2, or Ombor's finish
// click for a fura) — never re-derived screen-side.
export interface PassportDispatch {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  status: string
  omborFinishedAt: string | null
  omborFinishedByName: string | null
  truckType: string
  loadedKg: number
  departedAt: string | null
  // Fura gate photos (2026-08-30, see DECISIONS.md "Fura CHIQIM gate
  // photos"): the guard's own record of a truck the gate never weighs —
  // car photo at entry, nakladnoy at exit. Null for a regular dispatch,
  // which has the four `gate` photos instead; either side of that is
  // populated, never both.
  photos: PassportFuraPhotos | null
  gate: PassportGate
  pallets: PassportDispatchPallet[]
}

export interface PassportFuraPhotos {
  kirdi: string | null
  chiqdi: string | null
}

// Raw dispatch (2026-07-31) — a distinct entry from PassportDispatch (which
// is pallet-based), kept as its own array so a serial's passport shows both
// exits without merging them into one list. See DECISIONS.md "Raw dispatch".
export interface PassportRawDispatch {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  weightKg: number
  boxMassKg: number
  netKg: number
  loadedAt: string
}

// Joriy holat (2026-08-07) — a genuine raw+finished balance reconciliation,
// replacing the old currentPosition (finished-goods-by-calibre only, and
// silently dropped any pallet awaiting a lab verdict). Two independent
// balances, not one combined equation: raw-sent-to-Moyka vs finished-
// returned has a real gap (wash yield loss, yield_rows' own domain).
// stillInStorageKg on both sides is read directly from stock_on_hand_rows
// (qoldig'i), not recomputed — see DECISIONS.md "Old-stock reconciliation"
// for the standing raw-balance two-implementations hazard this must not add
// a third instance of.
export interface PassportJoriyHolatRaw {
  receivedKg: number
  sentToMoykaKg: number
  collectedRawKg: number
  // This serial's DERIVED share of an old-raw close-out (the close-out
  // itself only books a lump per owner+type, never per serial) -- 0 unless
  // storageLossClosedAt is set.
  storageLossKg: number
  storageLossClosedAt: string | null
  stillInStorageKg: number
}

export interface PassportJoriyHolatFinishedByCalibre {
  calibreId: string
  availableKg: number
  reservedKg: number
  underReviewKg: number
}

export interface PassportJoriyHolatFinished {
  returnedKg: number
  dispatchedKg: number
  storageLossKg: number
  // Rare exits, included so the equation never has a silent unexplained
  // residual: consumed = used as a mint source for another serial; voided =
  // bekor_qilindi.
  consumedKg: number
  voidedKg: number
  stillInStorageKg: number
  stillInStorageBreakdown: {
    availableKg: number
    reservedKg: number
    awaitingLabKg: number
    needsRewashKg: number
  }
  byCalibre: PassportJoriyHolatFinishedByCalibre[]
}

export interface PassportJoriyHolat {
  raw: PassportJoriyHolatRaw
  finished: PassportJoriyHolatFinished
}

// Two genuinely different shapes unioned into one array (old_washed is
// per-pallet and exact; old_raw is a derived per-serial share of a
// per-owner+type close-out lump) -- fields are only present for their own
// kind, not nulled out for the other.
export interface PassportStorageLossEvent {
  kind: 'old_washed' | 'old_raw'
  weightKg: number
  barcode2?: string
  calibreId?: string
  voidedAt?: string
  closedAt?: string
  note?: string
}

// Symptom-A fix: a request that has reserved this serial's raw material
// (chiqim_line_raw_serials) but hasn't produced the completed event yet (no
// raw_dispatch_lines row) -- previously invisible on the passport even
// though it's already visible on the CHIQIM screen.
//
// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table"): this used to also carry a
// kind='finished' case, sourced from chiqim_line_pallets (Option B's
// reservation table). That table is gone, and FIFO attribution now happens
// only at Ombor's finalize click -- a still-open finished/old_washed
// chiqim_line has no specific pallets reserved in advance to report as
// "pending" for any one serial, so that case is simply gone, not replaced.
// Flagged as a real gap, not silently worked around.
export interface PassportPendingDispatch {
  kind: 'raw'
  requestId: string
  requestDate: string
  plate: string
  driver: string
}

// §5.4 FIFO dispatch (2026-08-28) -- this serial's own finished pallets'
// dispatched kg, by calibre, sourced from chiqim_pallet_consumption
// (migrations 0087/0088). Scoped to gate-completed (truly departed)
// consumption only, consistent with every other "departed" figure
// elsewhere on this passport (dispatches[], joriyHolat.finished.dispatchedKg).
export interface PassportDispatchedByCalibre {
  calibreId: string
  kg: number
}

export interface SerialPassport {
  serial: string
  order: PassportOrder | null
  effectiveQty: PassportEffectiveQty | null
  gate: PassportGate | null
  intake: PassportIntake | null
  kirimLab: PassportKirimLab | null
  cycles: PassportCycle[]
  dispatches: PassportDispatch[]
  rawDispatches: PassportRawDispatch[]
  // Stage 3: null unless this serial was minted from consumed sources.
  mintOrigin: PassportMintOrigin | null
  // Stage 3: entity_type='moyka' notes keyed by this serial -- includes the
  // auto-note the mint writes recording old-stock lineage.
  notes: PassportNote[]
  joriyHolat: PassportJoriyHolat
  storageLossEvents: PassportStorageLossEvent[]
  pendingDispatches: PassportPendingDispatch[]
  dispatchedByCalibre: PassportDispatchedByCalibre[]
}

export async function fetchSerialPassport(serial: string): Promise<SerialPassport> {
  const { data, error } = await supabase.rpc('get_serial_passport', { p_serial: serial })
  if (error) throw error
  return data as SerialPassport
}
