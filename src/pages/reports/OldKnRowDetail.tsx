import type { OldKnReportRow } from '../../lib/reportQuery'

// Row-expand content for an old-KN collection row -- sibling to
// RawDispatchRowDetail.tsx, same "expand reveals the rest" contract. Old-KN
// has even less to show than raw dispatch: no serial (so no passport link),
// no box mass -- just the collected weight itself, already shown in the row.
export function OldKnRowDetail({ row }: { row: OldKnReportRow }) {
  return (
    <div className="mt-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      Eski Konditirskiy yig'ib olindi: {row.weightKg.toLocaleString()} kg
    </div>
  )
}
