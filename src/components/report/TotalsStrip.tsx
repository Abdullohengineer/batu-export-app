import type { ReportTotals } from '../../lib/reportQuery'
import { toneStyles } from '../../components/ui/tokens'

function kg(v: number) {
  return `${Math.round(v).toLocaleString()} kg`
}

// §3.2.4 🔒 "Filtered-totals strip... recalculates against the active
// filter... sticky while scrolling" (§2.11 filtered-totals global rule).
// Sticky to the viewport top -- unchanged behavior. Visual treatment
// restyled to the mockup's bordered "FILTRLANGAN JAMI" info box (same
// `info` tone the rest of the nav/visual-redesign pass uses for highlight
// content) in place of the previous plain slate strip -- same numbers,
// same totals, no logic change.
export function TotalsStrip({ totals, dateBasisText }: { totals: ReportTotals; dateBasisText: string }) {
  return (
    <div
      className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-md border px-4 py-2 text-sm backdrop-blur ${toneStyles.info.border} ${toneStyles.info.bg}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${toneStyles.info.text}`}>Filtrlangan jami</span>
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
