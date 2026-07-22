import type { ReactNode } from 'react'

// Small monospace chip for a serial / "So'rov" placeholder (mockup: the
// light-grey rounded box on the left of every KIRIM/CHIQIM/Hisobot card).
// Presentation only -- the value passed in is whatever the caller already
// had (a real serial, or the literal "So'rov" string CHIQIM requests use
// today since they don't get one, per spec §5.4). No new data here.
export function SerialChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  )
}
