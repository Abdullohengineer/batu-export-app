import type { ReactNode } from 'react'

// Small monospace chip for a serial / "So'rov" placeholder (mockup: the
// light-grey rounded box on the left of every KIRIM/CHIQIM/Hisobot card).
// Presentation only -- the value passed in is whatever the caller already
// had (a real serial, or the literal "So'rov" string CHIQIM requests use
// today since they don't get one, per spec §5.4). No new data here.
//
// `variant` (Ombor card-polish pass): 'default' is this component's
// original, unchanged look -- still what all but two of this component's
// call sites render. 'emphasized'/'prominent' are opt-in overrides scoped
// to two specific Ombor cards that need the serial to read as primary/
// identifying data (OmborIntakeTab's Qabul qilingan list, OmborMoykaTab's
// Yuborishga tayyor list) -- every other call site is unaffected since
// 'default' is the prop's default and renders byte-identical classes.
const variantStyles = {
  default: 'bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  emphasized: 'bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  prominent: 'bg-blue-100 px-2.5 py-1.5 font-mono text-sm font-bold text-blue-900 dark:bg-blue-900/40 dark:text-blue-100',
} as const

export function SerialChip({
  children,
  variant = 'default',
}: {
  children: ReactNode
  variant?: keyof typeof variantStyles
}) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md ${variantStyles[variant]}`}>
      {children}
    </span>
  )
}
