import { touch } from './tokens'

export type ProcessKind = 'moyka' | 'rezka'

// Moyka | Rezka switch at the top of Ombor sections 2 and 3 (SPEC.md §5.R,
// Rezka Prompt 2). Same visual language as RoleTabs (the role-shell top
// tabs): plain text tabs, active one darker -- a two-segment toggle, not a
// route, because the choice is local to the section. aria-pressed so a
// screen reader (and Playwright's getByRole('button', { pressed })) can
// tell which line is showing.
export function ProcessPill({ value, onChange }: { value: ProcessKind; onChange: (next: ProcessKind) => void }) {
  const options: { kind: ProcessKind; label: string }[] = [
    { kind: 'moyka', label: 'Moyka' },
    { kind: 'rezka', label: 'Rezka' },
  ]
  return (
    <div role="group" aria-label="Jarayon" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {options.map((o) => {
        const active = o.kind === value
        return (
          <button
            key={o.kind}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.kind)}
            className={[
              'flex shrink-0 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors',
              touch.secondary,
              active
                ? 'text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
