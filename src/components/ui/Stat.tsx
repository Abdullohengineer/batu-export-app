import type { ReactNode } from 'react'
import { type Tone, toneStyles, typeScale } from './tokens'

// The big glanceable number — new to this pass, built for scan-load's
// running total ("how running total and exact-match state read at a
// glance," prompt 1's own ergonomics requirement) but generic enough for
// any single at-a-glance figure prompt 2 needs elsewhere (e.g. a similar
// total on Moyka/Tayyor screens).
//
// `sublabel` (nav/visual-redesign pass, Rahbar prompt) — an optional small
// trailing line under the number (e.g. "o'tgan oy 17.1% ▲", mockup
// "BATU-Rahbar-Screens-v1_1.pdf" p1's own loss-trend tile). Undefined by
// default, so every existing call site (QorovulKirimTab/QorovulChiqimTab)
// renders byte-identical to before.
//
// `valueSize` (Ombor card-polish pass): 'default' keeps the original
// `typeScale.stat` (text-3xl) every other call site still uses. 'compact'
// is an opt-in override scoped to OmborMoykaTab's Yuborishga tayyor card,
// whose three-tile row was overflowing at text-3xl.
export function Stat({
  value,
  label,
  tone = 'neutral',
  sublabel,
  valueSize = 'default',
}: {
  value: ReactNode
  label: string
  tone?: Tone
  sublabel?: ReactNode
  valueSize?: 'default' | 'compact'
}) {
  const valueClass = valueSize === 'compact' ? 'text-xl font-bold tabular-nums' : typeScale.stat
  return (
    <div className={`rounded-md border p-3 ${toneStyles[tone].border} ${toneStyles[tone].bg}`}>
      <div className={`${valueClass} ${tone === 'neutral' ? 'text-slate-900 dark:text-slate-100' : toneStyles[tone].text}`}>
        {value}
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
      {sublabel && <div className="mt-0.5 text-xs text-slate-400">{sublabel}</div>}
    </div>
  )
}
