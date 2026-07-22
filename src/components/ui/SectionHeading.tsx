import type { ReactNode } from 'react'
import { toneStyles } from './tokens'

// The `<h2 className="text-sm font-medium ...">` pattern repeated at the
// top of every window in every screen (Kutilmoqda / Faol / Yakunlangan /
// etc.), formalized. `tone="pending"` matches LaboratorKirimTab's existing
// amber "Sera kutilmoqda" heading.
export function SectionHeading({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'pending' }) {
  return (
    <h2 className={`text-sm font-medium ${tone === 'pending' ? toneStyles.pending.text : 'text-slate-700 dark:text-slate-300'}`}>
      {children}
    </h2>
  )
}
