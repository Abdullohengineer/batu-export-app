import { STOCK_BUCKET_LABEL, STOCK_BUCKET_ORDER, type StockOnHandSummaryRow } from '../../lib/stockOnHand'
import { toneStyles } from '../../components/ui/tokens'

// §3.2.6 header — same sticky filtered-totals-strip furniture as §3.2.4's
// TotalsStrip (§2.11), one number per bucket instead of kg-in/kg-out/net,
// plus §3.2.9 part C's one lab-turnaround stat shown here per that
// requirement ("an average on the stock view header"). Visual treatment
// matches TotalsStrip's own restyle (nav/visual-redesign pass) -- bordered
// `info`-tone box instead of the previous plain slate strip.
export function StockOnHandHeader({
  summary,
  turnaroundAvgDays,
}: {
  summary: StockOnHandSummaryRow[]
  turnaroundAvgDays: number | null
}) {
  const totalsByBucket = new Map<string, number>()
  for (const s of summary) {
    totalsByBucket.set(s.bucket, (totalsByBucket.get(s.bucket) ?? 0) + s.totalKg)
  }

  return (
    <div
      className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-md border px-4 py-2 text-sm backdrop-blur ${toneStyles.info.border} ${toneStyles.info.bg}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneStyles.info.text}`}>Filtrlangan jami</span>
        {STOCK_BUCKET_ORDER.map((bucket) => (
          <span key={bucket} className="text-slate-700 dark:text-slate-300">
            {STOCK_BUCKET_LABEL[bucket]}:{' '}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {Math.round(totalsByBucket.get(bucket) ?? 0).toLocaleString()} kg
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
