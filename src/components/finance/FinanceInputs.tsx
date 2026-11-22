import { useId, type ReactNode } from 'react'
import { formatSom, coverageHint, monthLabel, parseAmount, type AccountCardData } from '../../lib/financeFormat'

// Buxgalteriya form primitives (decision 0250), styled like the app's own
// FormField/TextInput rather than the mockup's dark palette.

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300'

/** So'm amount, shown with thousands separators while typing. */
export function AmountInput({
  label,
  value,
  onChange,
  large = false,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  large?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value ? formatSom(value) : ''}
          placeholder="0"
          onChange={(e) => onChange(parseAmount(e.target.value))}
          className={`${inputClass} pr-14 font-semibold tabular-nums ${large ? 'min-h-14 text-2xl' : ''}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-sm text-slate-400">so'm</span>
      </div>
    </div>
  )
}

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}

/** "Qaysi oy uchun" — closed periods are shown but can't be chosen (the DB refuses them anyway). */
export function MonthSelect({
  label,
  value,
  onChange,
  months,
  statuses,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  months: string[]
  statuses: Map<string, 'closed' | 'reopened'>
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {months.map((m) => {
          const st = statuses.get(m)
          return (
            <option key={m} value={m} disabled={st === 'closed'}>
              {monthLabel(m)}
              {st === 'closed' ? ' · yopilgan' : st === 'reopened' ? ' · qayta ochilgan' : ''}
            </option>
          )
        })}
      </select>
    </div>
  )
}

export function NoteInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  )
}

/** Single-choice pills (Xarajat turi, xizmat turi). */
export function ChoicePills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <fieldset>
      <legend className={labelClass}>{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Radio cards for "Qaysi hisobdan / hisobga", showing the live balance. */
export function AccountCards({
  legend,
  accounts,
  value,
  onChange,
  afterDelta,
}: {
  legend: string
  accounts: AccountCardData[]
  value: string
  onChange: (id: string) => void
  /** shows "→ new balance" on the selected card */
  afterDelta?: number
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((a) => {
          const selected = a.id === value
          const cov = coverageHint(a)
          return (
            <label
              key={a.id}
              className={`flex min-h-11 cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
                selected
                  ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800'
                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{a.name_uz}</span>
                <input type="radio" name={name} checked={selected} onChange={() => onChange(a.id)} className="h-4 w-4" />
              </span>
              <span className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSom(a.balance)}</span>
              <span className={`text-xs ${cov?.low ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                so'm{cov ? ` · ${cov.text}${cov.low ? ' ⚠' : ''}` : ''}
                {a.supplier_name ? ` · ${a.supplier_name}` : ''}
              </span>
              {selected && afterDelta !== undefined && afterDelta !== 0 && (
                <span className="mt-0.5 text-xs font-medium text-teal-700 dark:text-teal-400">→ {formatSom(a.balance + afterDelta)} so'm</span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40 sm:p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
