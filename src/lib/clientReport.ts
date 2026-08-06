// §3.2.7 Mijoz hisoboti (client report) -- row/document shapes mirroring
// get_client_report's JSONB output (supabase/migrations/0029_client_report.sql).
// Types only; useClientReport.ts is the I/O layer, clientReportExport.ts the
// Excel builder, clientReportLabels.ts the Uz/Ru dictionary.

export interface ClientReportCappedSerial {
  serial: string
  actualSentKg: number
  effectiveQtyKg: number
  overageKg: number
}

export interface ClientReportRawByType {
  typeId: string
  openingKg: number
  receivedKg: number
  sentToMoykaKg: number
  processedKg: number
  rawDispatchedKg: number
  moykadaKg: number
  closingKg: number
}

// Three-bucket reconciliation self-check (2026-08-01, see DECISIONS.md
// "Client report three-bucket raw balance") -- cumulative as-of period.to,
// not period-scoped, so xomKg + moykadaKg + cumulativeOutputKg +
// cumulativeLossKg + cumulativeRawDispatchedKg should equal totalReceivedKg;
// balancesKg is that difference and should be 0 (a nonzero value flags a
// real anomaly, e.g. a serial oversent beyond what it ever received).
export interface ClientReportReconciliation {
  totalReceivedKg: number
  xomKg: number
  moykadaKg: number
  cumulativeOutputKg: number
  cumulativeLossKg: number
  cumulativeRawDispatchedKg: number
  balancesKg: number
}

// Raw dispatch (2026-07-31, see DECISIONS.md "Raw dispatch") — one row per
// raw_dispatch_lines event in the period, kept SEPARATE from the finished-
// goods `dispatches` array at the report's top level so raw-taken and
// washed-and-collected are never merged into one list.
export interface ClientReportRawDispatch {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  serial: string
  weightKg: number
  boxMassKg: number
  netKg: number
}

export interface ClientReportRaw {
  openingKg: number
  receivedKg: number
  sentToMoykaKg: number // period flow, informational — closingKg subtracts the as-of-p_to cumulative send, not this
  processedKg: number
  processedActualSentKg: number
  processedOverageKg: number
  rawDispatchedKg: number // the second raw exit — a client collecting raw directly, alongside sentToMoykaKg
  moykadaKg: number // sent to Moyka but not yet packed, as of period.to — the in-processing bucket
  cappedSerials: ClientReportCappedSerial[]
  closingKg: number // openingKg + receivedKg − sentToMoyka(as-of-to) − rawDispatched(as-of-to), floored per line at 0
  processedBreakdown: {
    calibreKg: number
    konditirskiyKg: number
    lossKg: number
    lossPct: number
  }
  byType: ClientReportRawByType[]
  dispatches: ClientReportRawDispatch[]
  reconciliation: ClientReportReconciliation
}

// Old-KN collections (2026-08-05) -- kept as its own top-level section, not
// nested inside `raw` (old-KN is a distinct product, not raw material) and
// never merged into the raw three-bucket reconciliation. Mirrors how raw
// dispatch's own section was added -- a period total plus a flat events
// list, no opening/closing balance here (old_kn_pools tracks that balance
// separately, out of scope for this report).
export interface ClientReportOldKnCollection {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  typeId: string
  collectedKg: number
}

export interface ClientReportOldKn {
  collectedKg: number
  collections: ClientReportOldKnCollection[]
}

export interface ClientReportFinishedByCalibre {
  calibreId: string
  openingKg: number
  producedKg: number
  dispatchedKg: number
  closingKg: number
}

export interface ClientReportFinished {
  openingKg: number
  producedKg: number
  dispatchedKg: number
  closingKg: number
  byCalibre: ClientReportFinishedByCalibre[]
}

export interface ClientReportLabReading {
  moisturePct: number
  so2MgKg: number | null
  sampleDate: string
}

export interface ClientReportDeliveredLab extends ClientReportLabReading {
  verdict: 'o_tdi' | 'qayta_yuvish'
}

export interface ClientReportQualityRow {
  serial: string
  typeId: string
  plate: string
  driver: string
  arrivalDate: string
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  intakeLab: ClientReportLabReading | null
  deliveredLab: ClientReportDeliveredLab | null
}

export interface ClientReportDispatchPallet {
  barcode2: string
  serial: string
  calibreId: string
  weightKg: number
}

export interface ClientReportDispatch {
  requestId: string
  requestDate: string
  plate: string
  driver: string
  departedAt: string | null
  pallets: ClientReportDispatchPallet[]
}

export interface ClientReport {
  owner: { id: string; name: string }
  period: { from: string; to: string }
  raw: ClientReportRaw
  oldKn: ClientReportOldKn
  finished: ClientReportFinished
  qualityRecord: ClientReportQualityRow[]
  dispatches: ClientReportDispatch[]
}
