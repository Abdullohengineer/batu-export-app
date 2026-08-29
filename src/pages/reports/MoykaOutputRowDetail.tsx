import type { MoykaOutputReportRow } from '../../lib/reportQuery'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// Row-expand content for a MOYKADAN row — sibling to ChiqimRowDetail.tsx.
// This is the PRODUCTION event for this barcode2 (received_date), not its
// later dispatch — a CHIQIM row for the same pallet, if one exists, is a
// separate row on its own request_date (see reportQuery.ts's own comment on
// MoykaOutputReportRow). Deliberately unfiltered by pallet status at the row
// level, so a voided/consumed/storage-loss pallet still shows here — surface
// that status plainly rather than hiding it.
export function MoykaOutputRowDetail({
  row,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  row: MoykaOutputReportRow
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPassport: (serial: string) => void
}) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <div>
        Ona seriya: <span className="font-mono">{row.serial}</span> <PartiyaBadge partiyaNo={row.partiyaNo} /> ·{' '}
        {typeName(row.typeId)} · {calibreLabel(row.calibreId)}
      </div>
      <div>
        Laboratoriya: namligi {row.moisturePct !== null ? `${row.moisturePct}%` : 'tekshirilmagan'}
        {' · '}
        SO₂: {row.so2MgKg !== null ? `${row.so2MgKg} ppm` : "yo'q"}
        {' · '}
        Xulosa:{' '}
        {row.labVerdict === 'o_tdi' ? "o'tdi" : row.labVerdict === 'qayta_yuvish' ? 'qayta yuvish' : 'tekshirilmagan'}
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
