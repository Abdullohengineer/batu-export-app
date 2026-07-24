import { useState } from 'react'
import type { Owner } from '../../lib/useOwners'
import type { ProductType } from '../../lib/useProductTypes'
import type { Calibre } from '../../lib/useCalibres'
import { type ReportDirection, type LabVerdictFilter, type WashCycleFilter } from '../../lib/reportQuery'
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoFirstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export interface FilterOption {
  value: string
  label: string
}

// Generic single/multi field, shared by calibre/type/status below — a
// plain <select> when `multi` is false (Hisobot's existing, unchanged
// single-pick UX), a checkbox panel behind a toggle pill when true
// (stock-on-hand's "Kalibr 4 and Kalibr 6 at once" requirement). Native
// `<select multiple>` was considered and rejected: ctrl/cmd-click selection
// is not discoverable and doesn't work on touch at all.
function FilterField({
  label,
  allLabel,
  options,
  selected,
  onChange,
  multi,
  compact,
}: {
  label: string
  allLabel: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
  multi: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!multi) {
    return (
      <select
        value={selected[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        className={compact ? pillSelectClass : inputClass}
        aria-label={label}
      >
        <option value="">
          {compact ? `${label}: ${allLabel}` : allLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={compact ? pillSelectClass : `${inputClass} block text-left`}
        aria-expanded={open}
      >
        {label}
        {selected.length > 0 ? ` (${selected.length})` : `: ${allLabel}`}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 min-w-[12rem] overflow-y-auto rounded-md border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.length === 0 && <p className="px-2 py-1 text-sm text-slate-400">Yo'q</p>}
          {options.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="text-slate-700 dark:text-slate-300">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Tozalash
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// §3.2.2/§3.2.4 filter bar, generalized (this task) to serve a second,
// differently-shaped caller (§3.2.6 stock-on-hand) without duplicating the
// component. Every section below is now field-by-field rather than one
// `ReportFilters` object + `onChange` — Hisobot (the only other consumer)
// passes every field it always did, StockOnHand passes only what it needs
// (no direction/washCycle/labVerdict/plate/driver sections — omitting a
// section's onChange hides it entirely, no dead UI). Calibre/type/status
// are now `string[]`-based everywhere so a multi-select caller and a
// single-select caller share the identical FilterField control above.
export function ReportFilterBar({
  from,
  to,
  onDateRangeChange,

  ownerId,
  onOwnerIdChange,
  owners,

  typeIds,
  onTypeIdsChange,
  typeMultiSelect = false,
  productTypes,

  calibreIds,
  onCalibreIdsChange,
  calibreMultiSelect = false,
  calibres,

  statusOptions,
  statusValues,
  onStatusValuesChange,
  statusMultiSelect = false,
  statusLabel = 'Holat',

  search,
  onSearchChange,
  searchPlaceholder = 'Qidirish',

  direction,
  onDirectionChange,
  serial,
  onSerialChange,
  barcode2,
  onBarcode2Change,
  plate,
  onPlateChange,
  driver,
  onDriverChange,
  washCycle,
  onWashCycleChange,
  labVerdict,
  onLabVerdictChange,

  onReset,
}: {
  from: string
  to: string
  onDateRangeChange: (from: string, to: string) => void

  ownerId: string
  onOwnerIdChange: (id: string) => void
  owners: Owner[]

  typeIds: string[]
  onTypeIdsChange: (ids: string[]) => void
  typeMultiSelect?: boolean
  productTypes: ProductType[]

  calibreIds: string[]
  onCalibreIdsChange: (ids: string[]) => void
  calibreMultiSelect?: boolean
  calibres: Calibre[]

  statusOptions: FilterOption[]
  statusValues: string[]
  onStatusValuesChange: (values: string[]) => void
  statusMultiSelect?: boolean
  statusLabel?: string

  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string

  direction?: ReportDirection
  onDirectionChange?: (d: ReportDirection) => void
  serial?: string
  onSerialChange?: (v: string) => void
  barcode2?: string
  onBarcode2Change?: (v: string) => void
  plate?: string
  onPlateChange?: (v: string) => void
  driver?: string
  onDriverChange?: (v: string) => void
  washCycle?: WashCycleFilter
  onWashCycleChange?: (v: WashCycleFilter) => void
  labVerdict?: LabVerdictFilter
  onLabVerdictChange?: (v: LabVerdictFilter) => void

  onReset: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)

  const moreActiveCount = [
    calibreMultiSelect ? null : calibreIds.length > 0, // when calibre lives in the main row (stock-on-hand) it's not part of the collapsed count
    onBarcode2Change ? barcode2 : '',
    onPlateChange ? plate : '',
    onDriverChange ? driver : '',
    onWashCycleChange ? washCycle : '',
    onLabVerdictChange ? labVerdict : '',
  ].filter((v) => (typeof v === 'boolean' ? v : !!v)).length

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onDirectionChange && direction && (
          <div className="inline-flex rounded-full border border-slate-300 p-0.5 dark:border-slate-700">
            {(['both', 'kirim', 'chiqim'] as ReportDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDirectionChange(d)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  direction === d
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {DIRECTION_LABEL[d]}
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={() => onDateRangeChange(isoToday(), isoToday())} className={pillSelectClass}>
          Bugun
        </button>
        <button type="button" onClick={() => onDateRangeChange(defaultDateRange(7).from, isoToday())} className={pillSelectClass}>
          7 kun
        </button>
        <button type="button" onClick={() => onDateRangeChange(isoFirstOfMonth(), isoToday())} className={pillSelectClass}>
          Bu oy
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <input type="date" value={from} onChange={(e) => onDateRangeChange(e.target.value, to)} className={pillSelectClass} />
          —
          <input type="date" value={to} onChange={(e) => onDateRangeChange(from, e.target.value)} className={pillSelectClass} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={ownerId} onChange={(e) => onOwnerIdChange(e.target.value)} className={pillSelectClass} aria-label="Buyurtmachi">
          <option value="">Buyurtmachi: Hammasi</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        {!calibreMultiSelect && (
          <FilterField
            label="Mahsulot turi"
            allLabel="Hammasi"
            options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
            selected={typeIds}
            onChange={onTypeIdsChange}
            multi={typeMultiSelect}
            compact
          />
        )}

        <FilterField
          label={statusLabel}
          allLabel="Hammasi"
          options={statusOptions}
          selected={statusValues}
          onChange={onStatusValuesChange}
          multi={statusMultiSelect}
          compact
        />

        {onSerialChange && serial !== undefined ? (
          <input
            type="text"
            value={serial}
            onChange={(e) => onSerialChange(e.target.value)}
            placeholder="Seriya qidirish"
            className={`${pillSelectClass} w-40`}
          />
        ) : onSearchChange ? (
          <input
            type="text"
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={`${pillSelectClass} w-48`}
          />
        ) : null}

        {calibreMultiSelect && (
          <FilterField
            label="Mahsulot turi"
            allLabel="Hammasi"
            options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
            selected={typeIds}
            onChange={onTypeIdsChange}
            multi={typeMultiSelect}
            compact
          />
        )}
        {calibreMultiSelect && (
          <FilterField
            label="Kalibr"
            allLabel="Hammasi"
            options={calibres.map((c) => ({ value: c.id, label: c.label }))}
            selected={calibreIds}
            onChange={onCalibreIdsChange}
            multi={calibreMultiSelect}
            compact
          />
        )}

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
          {!calibreMultiSelect && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Kalibr</span>
              <FilterField
                label="Kalibr"
                allLabel="Hammasi"
                options={calibres.map((c) => ({ value: c.id, label: c.label }))}
                selected={calibreIds}
                onChange={onCalibreIdsChange}
                multi={calibreMultiSelect}
              />
            </label>
          )}
          {onBarcode2Change && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Barcode #2</span>
              <input
                type="text"
                value={barcode2 ?? ''}
                onChange={(e) => onBarcode2Change(e.target.value)}
                placeholder="PLT-…"
                className={inputClass}
              />
            </label>
          )}
          {onPlateChange && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Moshina raqami</span>
              <input type="text" value={plate ?? ''} onChange={(e) => onPlateChange(e.target.value)} className={inputClass} />
            </label>
          )}
          {onDriverChange && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Haydovchi</span>
              <input type="text" value={driver ?? ''} onChange={(e) => onDriverChange(e.target.value)} className={inputClass} />
            </label>
          )}
          {onWashCycleChange && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Yuvish sikli</span>
              <select
                value={washCycle ?? ''}
                onChange={(e) => onWashCycleChange(e.target.value as WashCycleFilter)}
                className={inputClass}
              >
                <option value="">Har qanday</option>
                <option value="1">1</option>
                <option value="2+">2+</option>
              </select>
            </label>
          )}
          {onLabVerdictChange && (
            <label className="text-sm">
              <span className="block text-slate-500 dark:text-slate-400">Laboratoriya xulosasi</span>
              <select
                value={labVerdict ?? ''}
                onChange={(e) => onLabVerdictChange(e.target.value as LabVerdictFilter)}
                className={inputClass}
              >
                <option value="">Hammasi</option>
                {(Object.keys(VERDICT_LABEL) as Exclude<LabVerdictFilter, ''>[]).map((v) => (
                  <option key={v} value={v}>
                    {VERDICT_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Tozalash
          </button>
        </div>
      )}
    </div>
  )
}
