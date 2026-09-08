import type { MoykaOutputReportRow } from '../../lib/reportQuery'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// Row-expand content for a MOYKADAN row — sibling to ChiqimRowDetail.tsx.
// Collapsed to a per-serial-per-period aggregate (2026-09-03, see
// reportQuery.ts's MoykaOutputReportRow comment and migration 0111) — this
// row no longer identifies a single pallet, so there is no single
// barcode2/calibre/lab reading left to show here. The per-pallet breakdown
// (Barcode #2, kalibr, kg, lab result) still exists and is still reachable
// — it lives on the serial passport's own Moyka section (SPEC.md §3.2.5),
// reused rather than rebuilt here.
export function MoykaOutputRowDetail({
  row,
  typeName,
  onOpenPassport,
}: {
  row: MoykaOutputReportRow
  typeName: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        Ona seriya: <span className="font-mono">{row.serial}</span> <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} /> ·{' '}
        {typeName(row.typeId)}
      </div>
      <div>
        Ushbu davrda Moykadan chiqqan (yakuniy mahsulot): <span className="font-medium text-slate-700 dark:text-slate-300">{row.weightKg.toLocaleString()} kg</span>
      </div>
      <div className="text-xs">
        Bir nechta pallet yig'indisi — har bir pallet (Barcode #2, kalibr, laboratoriya natijasi) seriya pasportida ko'rinadi.
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
