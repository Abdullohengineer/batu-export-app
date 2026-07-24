import { STOCK_BUCKET_LABEL, STOCK_BUCKET_ORDER, type StockOnHandTotals } from '../../lib/stockOnHand'
import { toneStyles } from '../../components/ui/tokens'

// §3.2.6 header — same sticky filtered-totals-strip furniture as §3.2.4's
// TotalsStrip (§2.11), one number per bucket instead of kg-in/kg-out/net,
// plus §3.2.9 part C's one lab-turnaround stat shown here per that
// requirement, plus a row count (requirement E) alongside the kg figures —
// "how many batches" is its own useful number, not derivable from kg alone
// once the screen is one row per barcode rather than one row per group.
// `totals` is recomputed client-side against whatever's currently filtered
// (stockOnHand.ts's computeStockOnHandTotals) every time the filter set
// changes, not fetched separately — see useStockOnHand.ts for why.
export function StockOnHandHeader({
  totals,
  turnaroundAvgDays,
}: {
  totals: StockOnHandTotals
  turnaroundAvgDays: number | null
}) {
  return (
    <div
      className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-md border px-4 py-2 text-sm backdrop-blur ${toneStyles.info.border} ${toneStyles.info.bg}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneStyles.info.text}`}>Filtrlangan jami</span>
        <span className="text-slate-700 dark:text-slate-300">
          Qatorlar: <span className="font-medium text-slate-900 dark:text-slate-100">{totals.rowCount}</span>
        </span>
        {STOCK_BUCKET_ORDER.map((bucket) => (
          <span key={bucket} className="text-slate-700 dark:text-slate-300">
            {STOCK_BUCKET_LABEL[bucket]}:{' '}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {Math.round(totals.kgByBucket[bucket]).toLocaleString()} kg
            </span>
          </span>
        ))}
      </div>
      <span className="text-xs text-slate-400">
        {turnaroundAvgDays === null ? 'Tahlil o\'rtacha muddati: ma\'lumot yo\'q' : `Tahlil o'rtacha muddati: ${turnaroundAvgDays.toFixed(1)} kun`}
      </span>
    </div>
  )
}
