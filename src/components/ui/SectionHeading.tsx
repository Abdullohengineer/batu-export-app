import type { ReactNode } from 'react'
import { type Tone, toneStyles } from './tokens'

// The `<h2 className="text-sm font-medium ...">` pattern repeated at the
// top of every window in every screen (Kutilmoqda / Faol / Yakunlangan /
// etc.), formalized. `tone="pending"` matches LaboratorKirimTab's existing
// amber "Sera kutilmoqda" heading. Widened from neutral|pending to the full
// `Tone` type for the nav/visual-redesign pass -- `tone="info"` is now used
// for form section titles ("Yangi kiruvchi buyurtma" etc.) matching the
// mockup's blue heading treatment. `toneStyles.neutral.text` is byte-
// identical to the old hardcoded default, so every existing usage renders
// unchanged.
export function SectionHeading({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <h2 className={`text-sm font-medium ${toneStyles[tone].text}`}>{children}</h2>
}
