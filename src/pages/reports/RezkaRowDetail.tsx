import type { RezkaReportRow } from '../../lib/reportQuery'
import { REZKA_DIRECTION_LABEL, rezkaManbaText, rezkadaText } from '../../lib/rezkaReportLabels'

// Row-expand content for the four Rezka kinds (2026-09-28, Rezka Prompt 4)
// -- sibling to MoykaSendRowDetail.tsx. Manba with the parent pallets, the
// serial's Rezka balance, and the passport link (the passport carries the
// per-cycle breakdown).
export function RezkaRowDetail({
  row,
  onOpenPassport,
}: {
  row: RezkaReportRow
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        {REZKA_DIRECTION_LABEL[row.kind]}: {row.weightKg.toLocaleString()} kg
      </div>
      <div>Manba: {rezkaManbaText(row)}</div>
      <div>
        Rezkaga yuborilgan (jami): {row.rezka.rezkagaYuborilgan.toLocaleString()} kg · Rezkadan chiqgan (jami):{' '}
        {row.state.moykadanChiqganLifetime.toLocaleString()} kg · Rezkada: {rezkadaText(row.rezka.rezkada)}
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
