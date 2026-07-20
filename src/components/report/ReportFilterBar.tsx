import { useState } from 'react'
import type { Owner } from '../../lib/useOwners'
import type { ProductType } from '../../lib/useProductTypes'
import type { Calibre } from '../../lib/useCalibres'
import { defaultReportFilters, type ReportFilters, type ReportDirection, type LabVerdictFilter, type PalletStatusFilter, type WashCycleFilter } from '../../lib/reportQuery'

const inputClass =
  'mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const DIRECTION_LABEL: Record<ReportDirection, string> = { kirim: 'KIRIM', chiqim: 'CHIQIM', both: 'Ikkalasi' }
const VERDICT_LABEL: Record<Exclude<LabVerdictFilter, ''>, string> = {
  o_tdi: "O'tdi",
  qayta_yuvish: 'Qayta yuvish',
  tekshirilmagan: 'Tekshirilmagan',
}
const STATUS_LABEL: Record<Exclude<PalletStatusFilter, ''>, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
}

// §3.2.2/§3.2.4 filter bar. Own component (deliberately not folded into
// HistoryView.tsx — Ombor/Qorovul's existing Hisobotlar screens keep their
// current always-expanded filter row unchanged, per CLAUDE.md scope
// discipline). Reporting is a desktop surface (Menejer/Rahbar, on PCs) —
// expanded by default, no need to collapse on a wide screen — but the
// collapse toggle itself stays (cheap, still useful on a narrower window).
// Collapsed state shows a one-line summary of what's active.
export function ReportFilterBar({
  filters,
  onChange,
  owners,
  productTypes,
  calibres,
}: {
  filters: ReportFilters
  onChange: (next: ReportFilters) => void
  owners: Owner[]
  productTypes: ProductType[]
  calibres: Calibre[]
}) {
  const [expanded, setExpanded] = useState(true)

  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  function reset() {
    onChange(defaultReportFilters(filters.from, filters.to))
  }

  const activeCount = [
    filters.ownerId,
    filters.typeId,
    filters.calibreId,
    filters.serial,
    filters.barcode2,
    filters.plate,
    filters.driver,
    filters.washCycle,
    filters.labVerdict,
    filters.status,
  ].filter((v) => v !== '').length

  const summaryOwner = filters.ownerId ? (owners.find((o) => o.id === filters.ownerId)?.name ?? '') : ''

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
      >
        <span className="text-slate-700 dark:text-slate-300">
          {DIRECTION_LABEL[filters.direction]} · {filters.from} — {filters.to}
          {summaryOwner && <> · {summaryOwner}</>}
          {activeCount > 0 && (
            <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {activeCount} ta filtr
            </span>
          )}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{expanded ? 'Yopish ▲' : 'Filtrlar ▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Yo'nalish</span>
            <select
              value={filters.direction}
              onChange={(e) => set('direction', e.target.value as ReportDirection)}
              className={inputClass}
            >
              <option value="both">Ikkalasi</option>
              <option value="kirim">KIRIM</option>
              <option value="chiqim">CHIQIM</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Sanadan</span>
            <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Sanagacha</span>
            <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Buyurtmachi</span>
            <select value={filters.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={inputClass}>
              <option value="">Hammasi</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Tur</span>
            <select value={filters.typeId} onChange={(e) => set('typeId', e.target.value)} className={inputClass}>
              <option value="">Hammasi</option>
              {productTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Kalibr</span>
            <select value={filters.calibreId} onChange={(e) => set('calibreId', e.target.value)} className={inputClass}>
              <option value="">Hammasi</option>
              {calibres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Seriya (Barcode #1)</span>
            <input
              type="text"
              value={filters.serial}
              onChange={(e) => set('serial', e.target.value)}
              placeholder="150726-001"
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Barcode #2</span>
            <input
              type="text"
              value={filters.barcode2}
              onChange={(e) => set('barcode2', e.target.value)}
              placeholder="PLT-…"
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Moshina raqami</span>
            <input type="text" value={filters.plate} onChange={(e) => set('plate', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Haydovchi</span>
            <input type="text" value={filters.driver} onChange={(e) => set('driver', e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Yuvish sikli</span>
            <select value={filters.washCycle} onChange={(e) => set('washCycle', e.target.value as WashCycleFilter)} className={inputClass}>
              <option value="">Har qanday</option>
              <option value="1">1</option>
              <option value="2+">2+</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Laboratoriya xulosasi</span>
            <select value={filters.labVerdict} onChange={(e) => set('labVerdict', e.target.value as LabVerdictFilter)} className={inputClass}>
              <option value="">Hammasi</option>
              {(Object.keys(VERDICT_LABEL) as Exclude<LabVerdictFilter, ''>[]).map((v) => (
                <option key={v} value={v}>
                  {VERDICT_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Holat</span>
            <select value={filters.status} onChange={(e) => set('status', e.target.value as PalletStatusFilter)} className={inputClass}>
              <option value="">Hammasi</option>
              {(Object.keys(STATUS_LABEL) as Exclude<PalletStatusFilter, ''>[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Tozalash
          </button>
        </div>
      )}
    </div>
  )
}
