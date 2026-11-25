import { useId } from 'react'
import { monthLabel, monthOptions } from '../../lib/financeFormat'
import { usePeriodStatuses } from '../../lib/useFinance'

// Period chip for Moliyaviy ko'rsatkichlar (mockup: "● Noyabr 2026 · joriy",
// "● Oktabr 2026 · tugallangan"; decision 0256). A teal-bordered chip with a
// dot and a muted status suffix; the real <select> sits invisibly on top so
// keyboard, screen readers and native pickers keep working.
export function PeriodPicker({ value, onChange, current }: { value: string; onChange: (m: string) => void; current: string }) {
  const id = useId()
  const statuses = usePeriodStatuses()
  const suffix = (m: string) => {
    if (m === current) return 'joriy'
    return statuses.get(m) === 'closed' ? 'tugallangan' : 'ochiq'
  }
  return (
    <div className="relative inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-[var(--accent-income)] bg-[var(--surface)] py-1.5 pl-3.5 pr-3 text-sm">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--accent-income)]" />
      <span className="font-medium text-[var(--text-primary)]">{monthLabel(value)}</span>
      <span className="text-[var(--text-muted)]">· {suffix(value)}</span>
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 text-[var(--text-muted)]" fill="currentColor">
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <label htmlFor={id} className="sr-only">
        Davr
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {monthOptions(current, 12, 0).map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)} · {suffix(m)}
          </option>
        ))}
      </select>
    </div>
  )
}
