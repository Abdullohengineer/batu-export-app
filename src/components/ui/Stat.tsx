import type { ReactNode } from 'react'
import { type Tone, toneStyles, typeScale } from './tokens'

// The big glanceable number — new to this pass, built for scan-load's
// running total ("how running total and exact-match state read at a
// glance," prompt 1's own ergonomics requirement) but generic enough for
// any single at-a-glance figure prompt 2 needs elsewhere (e.g. a similar
// total on Moyka/Tayyor screens).
export function Stat({ value, label, tone = 'neutral' }: { value: ReactNode; label: string; tone?: Tone }) {
  return (
    <div className={`rounded-md border p-3 ${toneStyles[tone].border} ${toneStyles[tone].bg}`}>
      <div className={`${typeScale.stat} ${tone === 'neutral' ? 'text-slate-900 dark:text-slate-100' : toneStyles[tone].text}`}>
        {value}
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}
