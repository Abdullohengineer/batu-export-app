import type { ReportTotals } from '../../lib/reportQuery'

function kg(v: number) {
  return `${Math.round(v).toLocaleString()} kg`
}

// §3.2.4 🔒 "Filtered-totals strip... recalculates against the active
// filter... sticky while scrolling" (§2.11 filtered-totals global rule).
// Sticky to the viewport top (RoleShell's own header scrolls away normally,
// it isn't fixed — so this is the first thing that pins once the page
// scrolls past it), same slate/amber/emerald vocabulary as every other
// screen in this app, no new visual language introduced.
export function TotalsStrip({ totals, dateBasisText }: { totals: ReportTotals; dateBasisText: string }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-slate-200 bg-slate-50/95 px-4 py-2 text-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-slate-700 dark:text-slate-300">
          Kirim: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.kgIn)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Chiqim: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.kgOut)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Neto:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {totals.net >= 0 ? '+' : ''}
            {kg(totals.net)}
          </span>
        </span>
      </div>
      <span className="text-xs text-slate-400">{dateBasisText}</span>
    </div>
  )
}
