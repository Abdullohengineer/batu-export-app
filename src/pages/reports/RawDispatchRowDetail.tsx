import type { RawDispatchReportRow } from '../../lib/reportQuery'

// Row-expand content for a raw-dispatch row — sibling to KirimRowDetail.tsx/
// ChiqimRowDetail.tsx, same "expand reveals the rest" contract. Raw dispatch
// (2026-07-31) has no calibre/barcode2/lab verdict to show — the one extra
// fact worth surfacing here is the gross/tara breakdown behind the net kg
// already shown in the row itself.
export function RawDispatchRowDetail({
  row,
  onOpenPassport,
}: {
  row: RawDispatchReportRow
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        Vazn: {row.weightKg.toLocaleString()} kg
        {row.boxMassKg !== null && ` − quti massasi ${row.boxMassKg.toLocaleString()} kg`}
      </div>
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
