import type { ReactNode } from 'react'
import { type Tone, toneStyles } from './tokens'

// Inline status text — the existing app's "✓ Aniq mos keldi" / "Ortiqcha:
// +200 kg" / red error convention, formalized. `problem` gets role="alert"
// automatically (matches every existing error message in the app);
// `pending`/`ok` get role="status" (soft, non-blocking) since they're
// informational, not something screen readers should interrupt for.
export function StatusNote({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p
      className={`text-sm font-medium ${toneStyles[tone].text}`}
      role={tone === 'problem' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}
