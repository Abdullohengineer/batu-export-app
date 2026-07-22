import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { touch } from './tokens'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  tone?: 'neutral' | 'danger'
}

// Icon-only controls (remove a scan, expand a row) — the existing app
// rendered these as bare text glyphs with no explicit hit area (e.g. a "✕"
// with only its own glyph size to tap), which is real friction on a phone.
// This guarantees the 44px minimum tap target from `tokens.ts` regardless
// of how small the glyph inside looks. `aria-label` (required, via
// `label`) keeps the existing app's convention of naming these actions for
// assistive tech and for Playwright's own `getByRole('button', { name })`
// lookups — same aria-label text as before, just a real hit target under it.
export function IconButton({ label, tone = 'neutral', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={[
        'inline-flex items-center justify-center rounded-md',
        touch.icon,
        tone === 'danger'
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-slate-500 dark:hover:bg-red-950/30 dark:hover:text-red-400'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200',
        'disabled:opacity-50',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
