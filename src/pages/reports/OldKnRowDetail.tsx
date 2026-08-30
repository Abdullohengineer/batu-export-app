import type { OldKnReportRow } from '../../lib/reportQuery'

// Row-expand content for an old-KN collection row -- sibling to
// RawDispatchRowDetail.tsx, same "expand reveals the rest" contract. Old-KN
// has no serial, so it never had RawDispatchRowDetail's "Seriya pasportini
// ko'rish" link -- but the request itself (Menejer/Ombor/Qorovul actors,
// times, gate photos) is real and already fully rendered elsewhere
// (FinishedChiqimList.tsx); it just had no drill-down FROM Hisobot. This
// button opens that same detail, scoped by requestId instead of a serial --
// see OldKnRequestPassportModal.tsx.
export function OldKnRowDetail({ row, onOpenOldKnRequest }: { row: OldKnReportRow; onOpenOldKnRequest: (requestId: string) => void }) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>Eski Konditerka yig'ib olindi: {row.weightKg.toLocaleString()} kg</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenOldKnRequest(row.requestId)
        }}
        className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
      >
        So'rov tafsilotlarini ko'rish →
      </button>
    </div>
  )
}
