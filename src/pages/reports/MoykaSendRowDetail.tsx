import type { MoykaSendReportRow } from '../../lib/reportQuery'

// Row-expand content for a MOYKAGA row — sibling to RawDispatchRowDetail.tsx.
// Internal movement (2026-08-15): no waybill, no gate weighing, no box mass
// to break out — just the sent weight, already shown in the row, plus the
// passport link.
export function MoykaSendRowDetail({
  row,
  onOpenPassport,
}: {
  row: MoykaSendReportRow
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>Moykaga yuborildi: {row.weightKg.toLocaleString()} kg</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenPassport(row.serial)
        }}
        className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
      >
        Seriya pasportini ko'rish →
      </button>
    </div>
  )
}
