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
  palletStatus: 'omborda' | 'band_qilingan' | 'jonatilgan' | 'bekor_qilingan'
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

export interface PassportCycle {
  cycleNo: number
  status: string
  finalLossPct: number | null
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

export interface PassportDispatch {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  status: string
  omborFinishedAt: string | null
  omborFinishedByName: string | null
  gate: PassportGate
  pallets: PassportDispatchPallet[]
}

export interface PassportCurrentPosition {
  calibreId: string
  inStockKg: number
  reservedKg: number
  collectedKg: number
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
  currentPosition: PassportCurrentPosition[]
}

export async function fetchSerialPassport(serial: string): Promise<SerialPassport> {
  const { data, error } = await supabase.rpc('get_serial_passport', { p_serial: serial })
  if (error) throw error
  return data as SerialPassport
}
