import { useState } from 'react'
import type { Owner } from '../../lib/useOwners'
import type { ProductType } from '../../lib/useProductTypes'
import type { Calibre } from '../../lib/useCalibres'
import { type ReportFilters, type ReportDirection, type LabVerdictFilter, type PalletStatusFilter, type WashCycleFilter, defaultReportFilters } from '../../lib/reportQuery'
import { defaultDateRange } from '../../lib/dateRange'

const inputClass =
  'mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const pillSelectClass =
  'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'

const DIRECTION_LABEL: Record<ReportDirection, string> = { kirim: 'Kirim', chiqim: 'Chiqim', both: 'Hammasi' }
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoFirstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// §3.2.2/§3.2.4 filter bar. Restyled for the mockup's pill row + segmented
// direction toggle ("BATU-Manager-Screens-MASTER.pdf" page 5) -- every
// field below reads/writes the exact same `ReportFilters` shape and
// `onChange` contract as before (no filter capability removed, several are
// just relocated behind "Ko'proq filtrlar" instead of always-expanded).
// Date-preset pills (Bugun/7 kun/Bu oy) are pure client-side convenience --
// they only ever call the same onChange('from'/'to', ...) the date inputs
// already do, no new query or derived value.
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
  const [moreOpen, setMoreOpen] = useState(false)

  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  function setRange(from: string, to: string) {
    onChange({ ...filters, from, to })
  }

  function reset() {
    onChange(defaultReportFilters(filters.from, filters.to))
  }

  const moreActiveCount = [
    filters.calibreId,
    filters.barcode2,
    filters.plate,
    filters.driver,
    filters.washCycle,
    filters.labVerdict,
  ].filter((v) => v !== '').length

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Segmented direction toggle -- same look as the mockup's
            Hammasi|Kirim|Chiqim control, mapped onto the existing
            `direction` filter (was a <select> with the same 3 values). */}
        <div className="inline-flex rounded-full border border-slate-300 p-0.5 dark:border-slate-700">
          {(['both', 'kirim', 'chiqim'] as ReportDirection[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => set('direction', d)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.direction === d
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {DIRECTION_LABEL[d]}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => setRange(isoToday(), isoToday())} className={pillSelectClass}>
          Bugun
        </button>
        <button type="button" onClick={() => setRange(defaultDateRange(7).from, isoToday())} className={pillSelectClass}>
          7 kun
        </button>
        <button type="button" onClick={() => setRange(isoFirstOfMonth(), isoToday())} className={pillSelectClass}>
          Bu oy
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={pillSelectClass} />
          —
          <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={pillSelectClass} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.ownerId}
          onChange={(e) => set('ownerId', e.target.value)}
          className={pillSelectClass}
          aria-label="Buyurtmachi"
        >
          <option value="">Buyurtmachi: Hammasi</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={filters.typeId}
          onChange={(e) => set('typeId', e.target.value)}
          className={pillSelectClass}
          aria-label="Mahsulot turi"
        >
          <option value="">Mahsulot turi: Hammasi</option>
          {productTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => set('status', e.target.value as PalletStatusFilter)} className={pillSelectClass} aria-label="Holat">
          <option value="">Status: Hammasi</option>
          {(Object.keys(STATUS_LABEL) as Exclude<PalletStatusFilter, ''>[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={filters.serial}
          onChange={(e) => set('serial', e.target.value)}
          placeholder="Seriya qidirish"
          className={`${pillSelectClass} w-40`}
        />

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="ml-auto rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {moreOpen ? 'Kamroq filtrlar ▲' : `Ko'proq filtrlar ▼${moreActiveCount > 0 ? ` (${moreActiveCount})` : ''}`}
        </button>
      </div>

      {moreOpen && (
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
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
