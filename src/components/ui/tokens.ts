// Shared design tokens — UX pass prompt 1/2 (see docs/DECISIONS.md "UX pass:
// design system + Ombor scan-load"). Single source of truth for touch
// sizing, type scale, and status-color mapping, so every component in
// `components/ui/` reads from here instead of repeating class strings —
// and so prompt 2 can roll the same system across every other screen
// without re-deriving these decisions.
//
// Colors are NAMED, not invented: amber/red/emerald/slate are the exact
// palette already load-bearing across QorovulKirimTab (red = active/urgent
// row), LaboratorKirimTab (amber = Sera kutilmoqda pending window, emerald/
// red = O'tdi/Qayta yuvish verdict), OmborIntakeTab (amber = variance
// note). This file just gives each an ONE name instead of four copy-pasted
// class strings per usage.

export type Tone = 'neutral' | 'pending' | 'problem' | 'ok'

// Touch-target sizing — factory floor, gloved/hurried thumb, not a mouse.
// Tailwind's default spacing scale already has the right numbers; the only
// job here is picking ONE value per tier and using it everywhere, instead
// of the existing app's ad hoc `px-3 py-1.5` (~32px, too small to be a
// reliable primary target).
export const touch = {
  /** 56px — the one primary/confirm action in view right now. */
  primary: 'min-h-14',
  /** 48px — secondary controls, form inputs. */
  secondary: 'min-h-12',
  /** 44px — icon-only controls (remove, expand). Smallest tier, still a real tap target. */
  icon: 'h-11 w-11',
} as const

// Type scale — bumped up from the existing app's uniform text-sm baseline
// specifically for scan-load's primary content, per "readable in poor
// lighting." Meta/caption sizes are left at the existing app's text-sm/
// text-xs so this doesn't read as a mismatched font size elsewhere on the
// same screen (section headings, timestamps) once prompt 2 rolls out.
export const typeScale = {
  /** Section labels — unchanged from the existing app (`text-sm font-medium`). */
  heading: 'text-sm font-medium',
  /** Primary readable line (barcode input, list rows). */
  body: 'text-base',
  /** Form field labels. */
  label: 'text-sm font-medium',
  /** Secondary/meta info (unchanged app convention). */
  meta: 'text-sm',
  /** Timestamps, fine print (unchanged app convention). */
  caption: 'text-xs',
  /** Big glanceable numbers (running totals). */
  stat: 'text-3xl font-bold tabular-nums',
} as const

interface ToneStyle {
  text: string
  border: string
  bg: string
}

// Exact shades already in use elsewhere in the app (chosen as canonical
// where two screens used slightly different shades of the same color —
// e.g. QorovulKirimTab's counter tile used red-200 for its border while its
// own active-row highlight used red-300; red-300 is picked here since it's
// the more prominent, closer-fit precedent for a highlighted state).
export const toneStyles: Record<Tone, ToneStyle> = {
  neutral: {
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    bg: '',
  },
  pending: {
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-300 dark:border-amber-900',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
  },
  problem: {
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-300 dark:border-red-900',
    bg: 'bg-red-50 dark:bg-red-950/30',
  },
  ok: {
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-300 dark:border-emerald-900',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
  },
}
