// §3.2.6 Ombor qoldig'i (stock on hand) — row shape mirrors reportQuery.ts's
// own split: this file holds shape + labels + the pure filter/aggregate
// functions, useStockOnHand.ts is the I/O layer. Backed by
// stock_on_hand_rows/lab_turnaround_avg (supabase/migrations/
// 0028_stock_on_hand_and_wip.sql, moisture_pct added + stock_on_hand_summary
// dropped this task — totals are now computed here, client-side, against
// whatever's already been fetched, since a full reseed-to-reseed reload of
// this screen's data is a bounded "right now" set, not the unbounded
// multi-month history §3.2.1-3.2.4's server-side engine exists to handle).

export type StockBucket = 'available' | 'band_qilingan' | 'awaiting_lab' | 'qayta_yuvish' | 'raw_not_washed'

export interface StockOnHandRow {
  bucket: StockBucket
  rowKey: string
  serial: string
  barcode2: string | null
  ownerId: string
  typeId: string
  calibreId: string | null
  qtyKg: number
  anchorDate: string
  daysHeld: number
  aged90: boolean
  moisturePct: number | null
}

// §3.2.6's five states, in the order the section itself lists them.
export const STOCK_BUCKET_ORDER: StockBucket[] = ['available', 'band_qilingan', 'awaiting_lab', 'qayta_yuvish', 'raw_not_washed']

export const STOCK_BUCKET_LABEL: Record<StockBucket, string> = {
  available: 'Mavjud',
  band_qilingan: 'Band qilingan',
  awaiting_lab: 'Tahlil kutilmoqda',
  qayta_yuvish: 'Qayta yuvish kerak',
  raw_not_washed: 'Xom, yuvilmagan',
}

export const STOCK_BUCKET_BADGE_CLASS: Record<StockBucket, string> = {
  available: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  band_qilingan: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  awaiting_lab: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  qayta_yuvish: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  raw_not_washed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export function stockBucketSortIndex(bucket: StockBucket): number {
  return STOCK_BUCKET_ORDER.indexOf(bucket)
}

// Multi-select everywhere it makes sense (calibre naturally excludes raw —
// a raw row has no calibre_id, so filtering by any calibre correctly drops
// every raw row, same as it would for a real finished-goods-only kalibr
// question). `search` matches barcode2 OR serial — one box, either ID type,
// since an operator scanning a sticker doesn't know in advance which one
// they're holding.
export interface StockOnHandFilters {
  ownerId: string
  typeIds: string[]
  calibreIds: string[]
  buckets: StockBucket[]
  from: string
  to: string
  search: string
}

// from/to default to '' (no bound), not a recent window like Hisobot's
// defaultReportFilters — this is a lookup surface for "everything a client
// has right now," including stock that's been sitting for months (that's
// exactly what the >90-day ageing flag exists to surface). Defaulting to a
// narrow date range would hide most real inventory the first time anyone
// opens this screen, defeating the point of the rework.
export function defaultStockOnHandFilters(): StockOnHandFilters {
  return { ownerId: '', typeIds: [], calibreIds: [], buckets: [], from: '', to: '', search: '' }
}

export function filterStockOnHandRows(rows: StockOnHandRow[], filters: StockOnHandFilters): StockOnHandRow[] {
  const search = filters.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (filters.ownerId && r.ownerId !== filters.ownerId) return false
    if (filters.typeIds.length > 0 && !filters.typeIds.includes(r.typeId)) return false
    if (filters.calibreIds.length > 0 && (!r.calibreId || !filters.calibreIds.includes(r.calibreId))) return false
    if (filters.buckets.length > 0 && !filters.buckets.includes(r.bucket)) return false
    if (filters.from && r.anchorDate < filters.from) return false
    if (filters.to && r.anchorDate > filters.to) return false
    if (search) {
      const hit = r.serial.toLowerCase().includes(search) || (r.barcode2?.toLowerCase().includes(search) ?? false)
      if (!hit) return false
    }
    return true
  })
}

// Newest-first (requirement D) — the one order every row, raw or finished,
// sorts by: the same anchorDate the ageing/days-held figure is already
// anchored on (SPEC §3.2.6: "the event that put it in its current bucket").
export function sortStockOnHandRowsNewestFirst(rows: StockOnHandRow[]): StockOnHandRow[] {
  return [...rows].sort((a, b) => (a.anchorDate < b.anchorDate ? 1 : a.anchorDate > b.anchorDate ? -1 : 0))
}

export interface StockOnHandTotals {
  kgByBucket: Record<StockBucket, number>
  rowCount: number
}

// Requirement E — recomputed against whatever's currently filtered, not the
// full unfiltered set. Pure/cheap: this screen's whole dataset is already
// in memory (useStockOnHand.ts fetches it in full), so there's no reason to
// round-trip a second aggregate query the way the old stock_on_hand_summary
// RPC did.
export function computeStockOnHandTotals(rows: StockOnHandRow[]): StockOnHandTotals {
  const kgByBucket = { available: 0, band_qilingan: 0, awaiting_lab: 0, qayta_yuvish: 0, raw_not_washed: 0 } as Record<StockBucket, number>
  for (const r of rows) kgByBucket[r.bucket] += r.qtyKg
  return { kgByBucket, rowCount: rows.length }
}
