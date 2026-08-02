// §3.2.6 Ombor qoldig'i (stock on hand) — row shape mirrors reportQuery.ts's
// own split: this file holds shape + labels + the pure filter/aggregate
// functions, useStockOnHand.ts is the I/O layer. Backed by
// stock_on_hand_rows/lab_turnaround_avg (supabase/migrations/
// 0028_stock_on_hand_and_wip.sql, moisture_pct added + stock_on_hand_summary
// dropped this task — totals are now computed here, client-side, against
// whatever's already been fetched, since a full reseed-to-reseed reload of
// this screen's data is a bounded "right now" set, not the unbounded
// multi-month history §3.2.1-3.2.4's server-side engine exists to handle).

// 'old_kn' (Stage 2, opening-stock collection) added 2026-08-02 -- a weight
// pool has no scan/lab-verdict lifecycle to bucket by, so it's its own
// terminal state rather than falling into one of the other five. Every
// old_kn row is old stock by construction (old_kn_pools has no current-
// stock equivalent); old-washed pallets and old-raw balance stay bucketed
// under the existing five states same as their current-stock counterparts,
// distinguished only via isOldStock -- this file's own STOCK_BUCKET_* maps
// only needed the one new entry.
export type StockBucket = 'available' | 'band_qilingan' | 'awaiting_lab' | 'qayta_yuvish' | 'raw_not_washed' | 'old_kn'

export interface StockOnHandRow {
  bucket: StockBucket
  rowKey: string
  // Null for an old_kn row -- a weight pool has no serial identity (Stage 1
  // design, see DECISIONS.md "Opening stock, Stage 1"). Every other bucket
  // always has one.
  serial: string | null
  barcode2: string | null
  ownerId: string
  typeId: string
  calibreId: string | null
  qtyKg: number
  // Null for an old_kn row -- a pool has no single arrival event to anchor
  // to (Stage 1 deliberately left it null rather than fabricate one).
  anchorDate: string | null
  daysHeld: number | null
  aged90: boolean
  moisturePct: number | null
  boxMassKg: number | null
  // Stage 2 (opening stock) -- true for every old_kn row and for any
  // pallet_rows/raw_rows row whose underlying finished_pallets/kirim_orders
  // record is flagged is_old_stock/origin='opening_stock'. Drives the
  // Eski zaxira toggle/badge, not a bucket of its own for the other kinds.
  isOldStock: boolean
  weightIsEstimate: boolean | null
}

// §3.2.6's five states, in the order the section itself lists them, plus
// old_kn (Stage 2) appended at the end -- a sixth, opening-stock-only state.
export const STOCK_BUCKET_ORDER: StockBucket[] = ['available', 'band_qilingan', 'awaiting_lab', 'qayta_yuvish', 'raw_not_washed', 'old_kn']

export const STOCK_BUCKET_LABEL: Record<StockBucket, string> = {
  available: 'Mavjud',
  band_qilingan: 'Band qilingan',
  awaiting_lab: 'Tahlil kutilmoqda',
  qayta_yuvish: 'Qayta yuvish kerak',
  raw_not_washed: 'Xom, yuvilmagan',
  old_kn: 'Eski KN (havza)',
}

export const STOCK_BUCKET_BADGE_CLASS: Record<StockBucket, string> = {
  available: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  band_qilingan: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  awaiting_lab: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  qayta_yuvish: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  raw_not_washed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  old_kn: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
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
  // Opening-stock toggle (Stage 2) — one control showing all three old-stock
  // kinds together (old-washed pallets, old-raw balance, old_kn pools),
  // regardless of which bucket they otherwise fall under. Off by default:
  // qoldig'i's default view is current stock, matching this screen's
  // existing "don't surprise the first-time view" convention (see from/to's
  // own comment below).
  oldStockOnly: boolean
}

// from/to default to '' (no bound), not a recent window like Hisobot's
// defaultReportFilters — this is a lookup surface for "everything a client
// has right now," including stock that's been sitting for months (that's
// exactly what the >90-day ageing flag exists to surface). Defaulting to a
// narrow date range would hide most real inventory the first time anyone
// opens this screen, defeating the point of the rework.
export function defaultStockOnHandFilters(): StockOnHandFilters {
  return { ownerId: '', typeIds: [], calibreIds: [], buckets: [], from: '', to: '', search: '', oldStockOnly: false }
}

export function filterStockOnHandRows(rows: StockOnHandRow[], filters: StockOnHandFilters): StockOnHandRow[] {
  const search = filters.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (filters.ownerId && r.ownerId !== filters.ownerId) return false
    if (filters.typeIds.length > 0 && !filters.typeIds.includes(r.typeId)) return false
    if (filters.calibreIds.length > 0 && (!r.calibreId || !filters.calibreIds.includes(r.calibreId))) return false
    if (filters.buckets.length > 0 && !filters.buckets.includes(r.bucket)) return false
    // Exclusive-mode toggle, not an additive filter (requirement: "read as
    // a distinct category, not scattered among current stock") -- current
    // stock and old stock never render in the same table at once. Off
    // (default) hides old stock entirely, matching this screen's behavior
    // before opening stock existed; on shows old stock only.
    if (filters.oldStockOnly !== r.isOldStock) return false
    // A null anchorDate (old_kn — a pool has no single arrival event, Stage
    // 1's own deliberate choice over fabricating one) has no date to compare
    // against a chosen range, so it's never excluded by from/to — the same
    // "date filtering doesn't apply" read as leaving it out entirely would
    // give, without a special bucket-shaped exception here.
    if (filters.from && r.anchorDate !== null && r.anchorDate < filters.from) return false
    if (filters.to && r.anchorDate !== null && r.anchorDate > filters.to) return false
    if (search) {
      const hit = (r.serial?.toLowerCase().includes(search) ?? false) || (r.barcode2?.toLowerCase().includes(search) ?? false)
      if (!hit) return false
    }
    return true
  })
}

// Newest-first (requirement D) — the one order every row, raw or finished,
// sorts by: the same anchorDate the ageing/days-held figure is already
// anchored on (SPEC §3.2.6: "the event that put it in its current bucket").
// A null anchorDate (old_kn) sorts last, on either side of the comparison —
// treated as "no date," not as oldest or newest.
export function sortStockOnHandRowsNewestFirst(rows: StockOnHandRow[]): StockOnHandRow[] {
  return [...rows].sort((a, b) => {
    if (a.anchorDate === null && b.anchorDate === null) return 0
    if (a.anchorDate === null) return 1
    if (b.anchorDate === null) return -1
    return a.anchorDate < b.anchorDate ? 1 : a.anchorDate > b.anchorDate ? -1 : 0
  })
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
  const kgByBucket = { available: 0, band_qilingan: 0, awaiting_lab: 0, qayta_yuvish: 0, raw_not_washed: 0, old_kn: 0 } as Record<StockBucket, number>
  for (const r of rows) kgByBucket[r.bucket] += r.qtyKg
  return { kgByBucket, rowCount: rows.length }
}
