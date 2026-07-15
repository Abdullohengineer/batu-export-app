import { useState } from 'react'
import { HistoryView } from '../../components/HistoryView'
import { defaultDateRange } from '../../lib/dateRange'
import { useOwners } from '../../lib/useOwners'
import { useGateHistory, type GateHistoryFilters, type GateStatus } from '../../lib/useGateHistory'

const STATUS_LABEL: Record<GateStatus, string> = {
  kirdi_boshatilmoqda: "Kirdi·bo'shatilmoqda",
  yakunlandi: 'Yakunlandi',
}

function kg(v: number | null) {
  return v !== null ? `${v.toLocaleString()} kg` : '—'
}

// Qorovul's Hisobotlar (task step 3): read-only gate_weighings history.
export function QorovulHisobotlar() {
  const initial = defaultDateRange()
  const [filters, setFilters] = useState<GateHistoryFilters>({
    from: initial.from,
    to: initial.to,
    plate: '',
    status: '',
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  const { owners } = useOwners()
  const { rows, loading } = useGateHistory(filters)

  function ownerName(id: string | null) {
    return owners.find((o) => o.id === id)?.name ?? '—'
  }
  function set<K extends keyof GateHistoryFilters>(key: K, value: GateHistoryFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <HistoryView
      loading={loading}
      isEmpty={rows.length === 0}
      emptyText="Reys topilmadi."
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
            <span className="block text-slate-500 dark:text-slate-400">Moshina raqami</span>
            <input
              type="text"
              value={filters.plate}
              onChange={(e) => set('plate', e.target.value)}
              placeholder="01A123BB"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Holat</span>
            <select
              value={filters.status}
              onChange={(e) => set('status', e.target.value as GateStatus | '')}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Hammasi</option>
              <option value="kirdi_boshatilmoqda">{STATUS_LABEL.kirdi_boshatilmoqda}</option>
              <option value="yakunlandi">{STATUS_LABEL.yakunlandi}</option>
            </select>
          </label>
        </>
      }
    >
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
          <button
            type="button"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-slate-900 dark:text-slate-100">
              {r.sana} · {r.plate} · {r.driver}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {r.direction.toUpperCase()} · {STATUS_LABEL[r.status]}
            </span>
          </button>
          <div className="mt-1 text-slate-500 dark:text-slate-400">
            Yuk bilan: {kg(r.gruzheny_kg)} · Bo'sh: {kg(r.pustoy_kg)} · Net: {kg(r.net_kg)} · Yakun:{' '}
            {r.completed_at ? new Date(r.completed_at).toLocaleString() : 'kutilmoqda'}
          </div>
          {expanded === r.id && (
            <div className="mt-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Buyurtmachi: {ownerName(r.ownerId)} · Jami avto (kutilgan):{' '}
              {r.declaredTotal !== null ? `${r.declaredTotal.toLocaleString()} kg` : '—'}
            </div>
          )}
        </div>
      ))}
    </HistoryView>
  )
}
