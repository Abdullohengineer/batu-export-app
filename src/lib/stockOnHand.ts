// §3.2.6 Ombor qoldig'i (stock on hand) — row shape mirrors reportQuery.ts's
// own split: this file holds shape + labels, useStockOnHand.ts is the I/O
// layer. Backed by stock_on_hand_rows/stock_on_hand_summary/lab_turnaround_avg
// (supabase/migrations/0028_stock_on_hand_and_wip.sql).

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
}

export interface StockOnHandSummaryRow {
  ownerId: string
  typeId: string
  calibreId: string | null
  bucket: StockBucket
  totalKg: number
  batchCount: number
  oldestDaysHeld: number
  aged90Count: number
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
