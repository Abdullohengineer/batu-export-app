import { useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarExceptions } from '../../lib/useRahbarDashboard'
import { EXCEPTION_KIND_LABEL, type ExceptionRow } from '../../lib/rahbarDashboard'
import { SerialPassportModal } from '../reports/SerialPassportModal'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

function detailText(row: ExceptionRow): string {
  const d = row.detail
  switch (row.exceptionKind) {
    case 'ageing_stock':
      return `${Math.round(Number(d.qtyKg))} kg — ${d.daysHeld} kun (${d.bucket})`
    case 'lab_overdue':
      return `${d.daysWaiting} kun kutilmoqda (chegara: ${d.thresholdDays} kun)`
    case 'high_loss':
      return `Yo'qotish ${d.lossPct}% (chegara: ${d.thresholdPct}%), xom ${Math.round(Number(d.rawConsumedKg))} kg`
    case 'high_rewash':
      return `${d.ratePct}% (${d.rewashCount}/${d.serialCount} seriya), chegara: ${d.thresholdPct}%`
    default:
      return ''
  }
}

// §6.2 Diqqat talab (Exceptions) — "what needs attention", not a row list.
// Four kinds, three reusing existing thresholds/views outright (§3.2.6's
// ageing, §3.2.9's lab-overdue, the existing abnormal_loss_pct), one new
// (high re-wash rate, §2.14's new high_rewash_rate_pct). Rahbar-only.
export function RahbarExceptionsTab() {
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { rows, loading } = useRahbarExceptions()
  const [passportSerial, setPassportSerial] = useState<string | null>(null)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string | null) {
    if (!id) return '—'
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabelLookup(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Diqqat talab qiladigan narsa yo'q.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                <th className={th}>Turi</th>
                <th className={th}>Buyurtmachi</th>
                <th className={th}>Tur / Seriya</th>
                <th className={th}>Tafsilot</th>
                <th className={th} aria-label="Batafsil" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.exceptionKind}-${row.rowKey}`} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
                      {EXCEPTION_KIND_LABEL[row.exceptionKind]}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
                  <td className={`${td} whitespace-nowrap font-mono text-slate-700 dark:text-slate-300`}>
                    {row.serial ?? typeName(row.typeId)}
                  </td>
                  <td className={`${td} text-slate-700 dark:text-slate-300`}>{detailText(row)}</td>
                  <td className={`${td} text-right`}>
                    {row.serial && (
                      <button
                        type="button"
                        onClick={() => setPassportSerial(row.serial)}
                        className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                      >
                        →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {passportSerial && (
        <SerialPassportModal serial={passportSerial} onClose={() => setPassportSerial(null)} typeName={typeName} calibreLabel={calibreLabelLookup} />
      )}
    </div>
  )
}
