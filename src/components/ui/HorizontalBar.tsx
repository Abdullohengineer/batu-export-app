// Horizontal bar row -- label | proportional bar | value (+ optional % of a
// total). Extracted from RahbarHome.tsx's own local `Bar` (2026-08-14, the
// "Omborda hozir — kalibr bo'yicha" section) so OldStockDrilldown.tsx's Эski
// drill-down can use the exact same row visual instead of a separate chart
// library (2026-09-08, see DECISIONS.md "Эski drill-down: horizontal bars,
// drop recharts"). Behaviour is unchanged from the original -- same grid
// template, same minimum-visible-width floor for a tiny nonzero value.
export function HorizontalBar({
  label,
  value,
  max,
  color,
  pctOfLabel,
}: {
  label: string
  value: number
  max: number
  color: string
  pctOfLabel?: string
}) {
  const widthPct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0
  return (
    <div className="grid grid-cols-[100px_1fr_92px] items-center gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <div className="h-6 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-md" style={{ width: `${widthPct}%`, background: color }} />
      </div>
      <span className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {Math.round(value).toLocaleString()}
        {pctOfLabel && <small className="ml-1 font-normal text-slate-400">{pctOfLabel}</small>}
      </span>
    </div>
  )
}
