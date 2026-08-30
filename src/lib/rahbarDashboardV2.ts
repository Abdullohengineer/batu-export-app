// Rahbar "Bosh sahifa" stock-reconciliation dashboard — types for the two
// RPCs backing it (supabase/migrations/0068_rahbar_dashboard.sql):
// rahbar_stock_snapshot(p_scope) and rahbar_dashboard_ledger(p_from, p_to, p_scope).
// See docs/DECISIONS.md 2026-08-12/13/14 for the full design history.
//
// Named "V2" / kept in its own file rather than replacing rahbarDashboard.ts
// (the trends/ranking/product-mix types) -- that RPC set is untouched by
// this migration and unrelated in shape; merging the two files would just
// make an unrelated diff noisier.

export type ZaxiraScope = 'yangi' | 'eski' | 'hammasi'

export const SCOPE_LABEL: Record<ZaxiraScope, string> = {
  yangi: 'Yangi',
  eski: 'Eski',
  hammasi: 'Hammasi',
}

export interface StockByType {
  typeId: string
  kg: number
}

// Current stock per (type, calibre) -- 2026-08-30, see DECISIONS.md "Rahbar
// dashboard corrections". Straight off stock_on_hand_rows (the same view
// Ombor qoldig'i reads), so the per-calibre bars show a LIVE BALANCE rather
// than the period flow they used to. typeId is carried so the Turlar filter
// still narrows them, exactly as it did for the byCalibreType rows.
export interface StockByCalibre {
  typeId: string
  calibreId: string
  isNumberless: boolean
  kg: number
}

export interface RahbarStockSnapshot {
  rawKg: number
  finishedCalibredKg: number
  konditirskiyKg: number
  oldKnKg: number
  // Material already sent to Moyka but not yet returned as finished output
  // (2026-08-22) -- deducted from rawKg the moment it's sent, not yet
  // counted in finishedCalibredKg/konditirskiyKg until Moyka actually
  // returns it. Point-in-time, same "right now" basis as every other field
  // here -- not the period-scoped moykadaSnapshot the ledger RPC returns.
  moykadaKg: number
  oldKnNote: string
  /** rawKg + moykadaKg + finishedCalibredKg + konditirskiyKg + oldKnKg. NOTE the
   *  dashboard's own headline deliberately EXCLUDES oldKnKg -- see RahbarHome. */
  totalKg: number
  /** Still returned, deliberately unused since the Zaxira tarkibi donut was
   *  removed (2026-08-30). Left in the payload rather than churning the RPC. */
  byType: StockByType[]
  byCalibre: StockByCalibre[]
  distinctTypeCount: number
}

export interface RahbarLedgerRaw {
  openingKg: number
  receivedKg: number
  dispatchedKg: number
  sentToMoykaKg: number
  storageLossKg: number
  closingKg: number
  /** Diagnostic only -- see migration header "Known edge case". 0 unless a line was sent/dispatched for more than its own effective raw qty. */
  residualKg: number
  residualNote: string
}

export interface RahbarMoykadaSnapshot {
  /** Point-in-time balance as of p_from -- not a period flow. */
  openingKg: number
  /** Point-in-time balance as of p_to -- not a period flow. */
  closingKg: number
  asOfDate: string
  /** Diagnostic only -- residual of openingKg + raw.sentToMoykaKg - moyka.processedKg - closingKg. 0 unless the over-send edge case fires. */
  residualKg: number
  note: string
}

export interface RahbarLedgerMoyka {
  processedKg: number
  calibreKg: number
  konditirskiyKg: number
  lossKg: number
  lossPct: number
}

export interface RahbarLedgerFinished {
  openingKg: number
  producedKg: number
  dispatchedKg: number
  closingKg: number
}

export interface ByCalibreTypeRow {
  typeId: string
  calibreId: string
  kg: number
}

export interface RahbarChartPoint {
  bucketStart: string
  kirdiKg: number
  chiqganKg: number
  vozvratKg: number
}

export interface RahbarDashboardLedger {
  period: { from: string; to: string; scope: ZaxiraScope; bucketDays: number }
  raw: RahbarLedgerRaw
  moykadaSnapshot: RahbarMoykadaSnapshot
  moyka: RahbarLedgerMoyka
  finished: RahbarLedgerFinished
  byCalibreType: { processed: ByCalibreTypeRow[]; dispatched: ByCalibreTypeRow[] }
  chart: RahbarChartPoint[]
}
