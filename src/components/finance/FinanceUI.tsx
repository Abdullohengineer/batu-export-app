import type { ReactNode } from 'react'
import { formatCompact } from '../../lib/financeFormat'
import { initials, signClass } from '../../lib/financeTheme'

// Shared pieces of the dark finance theme (decision 0256). They read the
// CSS tokens set under [data-theme="dark-finance"] (src/index.css), so they
// are only used inside /buxgalter/* and /<role>/moliya/*.

/** "+3.97M" / "−231.39M" in its semantic colour. */
export function Signed({ value, compact = true, suffix }: { value: number; compact?: boolean; suffix?: string }) {
  const body = compact ? formatCompact(value) : `${value < 0 ? '−' : ''}${Math.abs(Math.round(value)).toLocaleString('en-US')}`
  return (
    <span className={signClass(value)}>
      {value > 0 ? '+' : ''}
      {body}
      {suffix}
    </span>
  )
}

/** KPI tile: 11px uppercase label row, big number, 12px secondary row. */
export function Tile({ label, aside, children, footer }: { label: ReactNode; aside?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-[22px] py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-secondary)]">{label}</span>
        {aside}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.5px] tabular-nums text-[var(--text-primary)]">{children}</div>
      {footer && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">{footer}</div>}
    </div>
  )
}

/** Small muted label + primary value, for a tile's footer row. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      {label}: <span className="font-medium tabular-nums text-[var(--text-primary)]">{children}</span>
    </span>
  )
}

/** A card section on the finance surface. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 ${className}`}>{children}</section>
}

export type PillTone = 'open' | 'done' | 'critical' | 'neutral'
const PILL: Record<PillTone, string> = {
  open: 'bg-[rgb(245_180_92/0.12)] text-[var(--accent-warning)]',
  done: 'bg-[rgb(45_212_191/0.12)] text-[var(--accent-income)]',
  critical: 'bg-[rgb(251_113_133/0.12)] text-[var(--accent-critical)]',
  neutral: 'bg-[var(--surface-elev)] text-[var(--text-secondary)]',
}

/** Status pill: ochiq (warning orange), tugallangan (income teal), critical (pink). */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${PILL[tone]}`}>{children}</span>
}

/** Rounded view-switch pills (chart tabs). */
export function ViewPills<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors ${
            value === o.key
              ? 'border-[var(--border-strong)] bg-[var(--surface-elev)] text-[var(--text-primary)]'
              : 'border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 28px tinted square with 2-letter initials (entry rows). */
export function RowIcon({ name, color }: { name: string; color: string }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      {initials(name)}
    </span>
  )
}
