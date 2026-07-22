import type { ReactNode } from 'react'
import { type Tone, toneStyles } from './tokens'

// Filled status badge (mockup "BATU-Manager-Screens-MASTER.pdf": amber
// "Kutilmoqda" / green "Qabul qilindi" / "Olib ketildi" pills on every list
// card). New to this pass -- StatusNote (existing) is a full-width inline
// note with a role, meant for a warning/error LINE; this is a small at-a-
// glance badge for a row's own state, a different shape, so a new component
// rather than overloading StatusNote's contract. Same tone/color source as
// everything else (`toneStyles`) -- no new palette.
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneStyles[tone].bg} ${toneStyles[tone].text}`}
    >
      {children}
    </span>
  )
}
