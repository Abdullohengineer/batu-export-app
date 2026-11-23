import { useId } from 'react'
import { monthLabel, monthOptions } from '../../lib/financeFormat'
import { usePeriodStatuses } from '../../lib/useFinance'

// Period picker for Moliyaviy ko'rsatkichlar (mockup: "Noyabr 2026 · joriy",
// "Oktabr 2026 · tugallangan"). The status suffix tells the reader whether
// the numbers are still moving.
export function PeriodPicker({ value, onChange, current }: { value: string; onChange: (m: string) => void; current: string }) {
  const id = useId()
  const statuses = usePeriodStatuses()
  const suffix = (m: string) => {
    if (m === current) return 'joriy'
    const st = statuses.get(m)
    return st === 'closed' ? 'yopilgan' : st === 'reopened' ? 'qayta ochilgan' : 'ochiq'
  }
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Davr
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {monthOptions(current, 12, 0).map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)} · {suffix(m)}
          </option>
        ))}
      </select>
    </div>
  )
}
