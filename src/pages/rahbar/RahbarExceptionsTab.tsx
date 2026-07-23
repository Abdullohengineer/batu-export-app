import { useMemo, useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useRahbarExceptions } from '../../lib/useRahbarDashboard'
import { EXCEPTION_KIND_LABEL, EXCEPTION_KIND_ORDER, type ExceptionKind, type ExceptionRow } from '../../lib/rahbarDashboard'
import { SerialPassportModal } from '../reports/SerialPassportModal'
import { StatusPill } from '../../components/ui/StatusPill'
import type { Tone } from '../../components/ui/tokens'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

const pillClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
      : 'border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
  }`

// Severity read at a glance, per kind -- high_loss is money already lost
// (most severe); lab_overdue/ageing_stock are time-sensitive but not yet a
// loss; high_rewash is a rate/pattern worth watching, not an acute one.
const EXCEPTION_KIND_TONE: Record<ExceptionKind, Tone> = {
  high_loss: 'problem',
  lab_overdue: 'pending',
  ageing_stock: 'pending',
  high_rewash: 'info',
}

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
//
// Nav/visual-redesign pass (Rahbar prompt): kind-filter pills + serial/
// owner search, per mockup "BATU-Rahbar-Screens-v1_1.pdf" p2 -- both pure
// client-side narrowing over the SAME `rows` this screen already fetches in
// full (no new query), plus per-kind StatusPill coloring in place of the one
// hardcoded red pill every row got before regardless of kind -- exactly the
// "doesn't read as triage" gap the task called out (nothing was visually
// differentiated by severity before this). The mockup's own list shows 6-7
// problem kinds, including "Kam chiqdi" (shortfall) and "Nishonga to'g'ri
// kelmadi" (manifest-mismatch) detection; SPEC.md §6.2 still lists those
// too, but `rahbarDashboard.ts`'s ExceptionKind union has exactly the 4 this
// screen already builds, matching this task's own "four kinds" framing --
// kept at 4, did not add shortfall/manifest-mismatch detection logic.
export function RahbarExceptionsTab() {
  // §3.3: includeInactive=true -- resolves ids on exception rows that may
  // reference a since-deactivated client/type/calibre.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { rows, loading } = useRahbarExceptions()
  const [passportSerial, setPassportSerial] = useState<string | null>(null)
  const [activeKind, setActiveKind] = useState<ExceptionKind | 'all'>('all')
  const [search, setSearch] = useState('')

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

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<ExceptionKind, number>> = {}
    for (const row of rows) counts[row.exceptionKind] = (counts[row.exceptionKind] ?? 0) + 1
    return counts
  }, [rows])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (activeKind !== 'all' && row.exceptionKind !== activeKind) return false
      if (!term) return true
      return (row.serial ?? '').toLowerCase().includes(term) || ownerName(row.ownerId).toLowerCase().includes(term)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeKind, search, owners])

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setActiveKind('all')} className={pillClass(activeKind === 'all')}>
            Hammasi ({rows.length})
          </button>
          {EXCEPTION_KIND_ORDER.filter((kind) => kindCounts[kind]).map((kind) => (
            <button key={kind} type="button" onClick={() => setActiveKind(kind)} className={pillClass(activeKind === kind)}>
              {EXCEPTION_KIND_LABEL[kind]} ({kindCounts[kind]})
            </button>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Seriya yoki mijoz qidirish"
            className="ml-auto rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Diqqat talab qiladigan narsa yo'q.</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-slate-400">Filtrga mos yozuv topilmadi.</p>
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
              {visibleRows.map((row) => (
                <tr key={`${row.exceptionKind}-${row.rowKey}`} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={`${td} whitespace-nowrap`}>
                    <StatusPill tone={EXCEPTION_KIND_TONE[row.exceptionKind]}>{EXCEPTION_KIND_LABEL[row.exceptionKind]}</StatusPill>
                  </td>
                  <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{ownerName(row.ownerId)}</td>
                  <td className={`${td} whitespace-nowrap font-mono text-slate-700 dark:text-slate-300`}>
                    {row.serial ?? typeName(row.typeId)}
                  </td>
                  <td className={`${td} text-slate-700 dark:text-slate-300`}>{detailText(row)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {row.serial && (
                      <button
                        type="button"
                        onClick={() => setPassportSerial(row.serial)}
                        className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                      >
                        Pasport →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-slate-400">
          {visibleRows.length} / {rows.length} yozuv
        </p>
      )}

      {passportSerial && (
        <SerialPassportModal serial={passportSerial} onClose={() => setPassportSerial(null)} typeName={typeName} calibreLabel={calibreLabelLookup} />
      )}
    </div>
  )
}
