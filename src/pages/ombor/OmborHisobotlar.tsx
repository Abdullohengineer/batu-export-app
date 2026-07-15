import { useState } from 'react'
import { HistoryView } from '../../components/HistoryView'
import { defaultDateRange } from '../../lib/dateRange'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useIntakeHistory, type IntakeHistoryFilters } from '../../lib/useIntakeHistory'
import { IntakeDetailView } from './IntakeDetailView'

// Ombor's Hisobotlar (task step 4): read-only storage_intake history. Row
// expand reuses the Step 3 full-story view (IntakeDetailView) unchanged.
export function OmborHisobotlar() {
  const initial = defaultDateRange()
  const [filters, setFilters] = useState<IntakeHistoryFilters>({
    from: initial.from,
    to: initial.to,
    typeId: '',
    ownerId: '',
    seriya: '',
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { limits } = useSettingsLimits()
  const { rows, loading } = useIntakeHistory(filters)

  const kamChiqdiPct = limits.kam_chiqdi_pct ?? 5

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function set<K extends keyof IntakeHistoryFilters>(key: K, value: IntakeHistoryFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <HistoryView
      loading={loading}
      isEmpty={rows.length === 0}
      emptyText="Serial topilmadi."
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
            <span className="block text-slate-500 dark:text-slate-400">Seriya</span>
            <input
              type="text"
              value={filters.seriya}
              onChange={(e) => set('seriya', e.target.value)}
              placeholder="150726-001"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </>
      }
    >
      {rows.map((r) => {
        const varianceKg = r.intake.actual_qty - r.declared_qty
        const variancePct = r.declared_qty > 0 ? (varianceKg / r.declared_qty) * 100 : 0
        const isKamChiqdi = variancePct < -kamChiqdiPct

        return (
          <div key={r.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
            <button
              type="button"
              onClick={() => setExpanded(expanded === r.serial ? null : r.serial)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="font-mono text-slate-900 dark:text-slate-100">{r.serial}</span>
              <span className="text-slate-500 dark:text-slate-400">
                {typeName(r.type_id)} · {ownerName(r.owner_id)}
              </span>
            </button>
            <div className="mt-1 text-slate-500 dark:text-slate-400">
              Kutilgan: {r.declared_qty.toLocaleString()} kg · Aniq: {r.intake.actual_qty.toLocaleString()} kg ·{' '}
              <span className={isKamChiqdi ? 'font-medium text-red-600 dark:text-red-400' : ''}>
                Farq: {varianceKg >= 0 ? '+' : ''}
                {varianceKg.toLocaleString()} kg ({variancePct >= 0 ? '+' : ''}
                {variancePct.toFixed(1)}%){isKamChiqdi && ' — Kam chiqdi'}
              </span>
            </div>
            <div className="mt-1 text-slate-500 dark:text-slate-400">
              {r.intake.status} · {new Date(r.intake.confirmed_at).toLocaleString()}
            </div>
            {expanded === r.serial && (
              <IntakeDetailView line={r} ownerName={ownerName(r.owner_id)} typeName={typeName(r.type_id)} />
            )}
          </div>
        )
      })}
    </HistoryView>
  )
}
