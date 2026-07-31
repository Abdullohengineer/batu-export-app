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
  processedKg: number
  rawDispatchedKg: number
  closingKg: number
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
  processedKg: number
  processedActualSentKg: number
  processedOverageKg: number
  rawDispatchedKg: number // the second raw exit — a client collecting raw directly, alongside processedKg (sent to Moyka)
  cappedSerials: ClientReportCappedSerial[]
  closingKg: number // openingKg + receivedKg − processedKg − rawDispatchedKg
  processedBreakdown: {
    calibreKg: number
    konditirskiyKg: number
    lossKg: number
    lossPct: number
  }
  byType: ClientReportRawByType[]
  dispatches: ClientReportRawDispatch[]
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
  finished: ClientReportFinished
  qualityRecord: ClientReportQualityRow[]
  dispatches: ClientReportDispatch[]
}
