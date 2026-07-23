import { useState } from 'react'
import { HistoryView } from '../../components/HistoryView'
import { GatePhoto } from '../../components/GatePhoto'
import { defaultDateRange } from '../../lib/dateRange'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useLaboratorHistory, type LaboratorHistoryFilters } from '../../lib/useLaboratorHistory'
import { Card } from '../../components/ui/Card'
import { SerialChip } from '../../components/ui/SerialChip'
import { StatusPill } from '../../components/ui/StatusPill'

const VERDICT_LABEL: Record<string, string> = { o_tdi: "O'tdi", qayta_yuvish: 'Qayta yuvish' }

// §5.5.6 Tekshiruvlar tarixi — one filtered section, both directions, same
// table/filter furniture Ombor's Hisobotlar (useIntakeHistory.ts) already
// established: HistoryView shell, server-side date range, client-side
// enrichment filters.
export function LaboratorTarixTab() {
  const initial = defaultDateRange()
  const [filters, setFilters] = useState<LaboratorHistoryFilters>({
    from: initial.from,
    to: initial.to,
    scope: '',
    ownerId: '',
    typeId: '',
    calibreId: '',
    seriya: '',
    verdict: '',
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  // §3.3: includeInactive=true -- resolves names/labels on historical rows,
  // and every filter select must still be able to pick a deactivated
  // type/owner/calibre to filter history by it.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { rows, loading } = useLaboratorHistory(filters)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  function set<K extends keyof LaboratorHistoryFilters>(key: K, value: LaboratorHistoryFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <HistoryView
      loading={loading}
      isEmpty={rows.length === 0}
      emptyText="Tekshiruv topilmadi."
      resultCount={rows.length}
      filters={
        <>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Sanadan</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => set('from', e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Sanagacha</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => set('to', e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Yo'nalish</span>
            <select
              value={filters.scope}
              onChange={(e) => set('scope', e.target.value as LaboratorHistoryFilters['scope'])}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              <option value="kirim">KIRIM</option>
              <option value="chiqim">CHIQIM</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Tur</span>
            <select
              value={filters.typeId}
              onChange={(e) => set('typeId', e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              {productTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Buyurtmachi</span>
            <select
              value={filters.ownerId}
              onChange={(e) => set('ownerId', e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Kalibr</span>
            <select
              value={filters.calibreId}
              onChange={(e) => set('calibreId', e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              {calibres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Seriya</span>
            <input
              type="text"
              value={filters.seriya}
              onChange={(e) => set('seriya', e.target.value)}
              placeholder="150726-001"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Verdikt</span>
            <select
              value={filters.verdict}
              onChange={(e) => set('verdict', e.target.value as LaboratorHistoryFilters['verdict'])}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              <option value="o_tdi">O'tdi</option>
              <option value="qayta_yuvish">Qayta yuvish</option>
            </select>
          </label>
        </>
      }
    >
      {rows.map((r) => (
        <Card key={r.id} padding="compact">
          <button
            type="button"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            className="flex w-full items-center gap-2 text-left"
          >
            <SerialChip>{r.serial}</SerialChip>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {ownerName(r.owner_id)} · {typeName(r.type_id)}
              {r.cycleNo !== null && r.cycleNo > 1 && (
                <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">sikl {r.cycleNo}</span>
              )}
            </span>
            <span className="shrink-0 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">
              {r.scope}
            </span>
            {r.verdict && (
              <StatusPill tone={r.verdict === 'qayta_yuvish' ? 'problem' : 'ok'}>{VERDICT_LABEL[r.verdict]}</StatusPill>
            )}
          </button>
          <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
            {r.sample_date} · Namligi {r.moisture_pct}% · SO₂ {r.so2_mg_kg !== null ? `${r.so2_mg_kg} mg/kg` : "Yo'q · naturel"}
          </div>
          {expanded === r.id && (
            <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <div>
                Talab (mijoz): Namligi{' '}
                <span className="text-slate-400 dark:text-slate-500">
                  {r.target_moisture_pct !== null ? `${r.target_moisture_pct}%` : "Talab yo'q"}
                </span>{' '}
                · SO₂{' '}
                <span className="text-slate-400 dark:text-slate-500">
                  {r.target_so2_mg_kg !== null ? `${r.target_so2_mg_kg} mg/kg` : "Talab yo'q"}
                </span>
              </div>
              {r.sampled_pallet && (
                <div>
                  Namuna: {r.sampled_pallet}
                  {r.calibre_id && ` · ${calibreLabel(r.calibre_id)}`}
                </div>
              )}
              {r.note && <div>Qayd: {r.note}</div>}
              <GatePhoto path={r.sample_photo} label="Namuna rasmi" bucket="lab-photos" />
            </div>
          )}
        </Card>
      ))}
    </HistoryView>
  )
}
