import type { ReactNode } from 'react'
import { StatusNote } from './ui/StatusNote'

// Shared shell for a role's Hisobotlar (history) view: a filter bar, a
// results area, and empty/loading states. Deliberately NOT a generic table
// framework — each role plugs in its own filter controls, its own data hook,
// and its own result rows/columns. This is the piece Laborator's Hisobotlar
// will reuse later (Phase 4): a new role adds its own filters + hook + rows,
// not a new shell.
//
// `error`/`refreshing` (2026-09-21, Phase 2 step 5) -- optional so screens
// with their own separate error handling (e.g. HisobotTab.tsx, whose error
// merges several hooks) can keep passing neither; every history hook
// converted onto React Query in this step (useGateHistory/useIntakeHistory/
// useLaboratorHistory) passes both, so a failed fetch shows a StatusNote
// here instead of silently rendering an empty list, and a background
// refetch shows the same "yangilanmoqda…" indicator every other Phase 2
// hook uses.
export function HistoryView({
  filters,
  loading,
  refreshing,
  error,
  isEmpty,
  emptyText,
  resultCount,
  children,
}: {
  filters: ReactNode
  loading: boolean
  refreshing?: boolean
  error?: string | null
  isEmpty: boolean
  emptyText: string
  resultCount: number
  children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        {filters}
      </div>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : isEmpty ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <>
          <div className="space-y-2">{children}</div>
          <p className="text-xs text-slate-400">
            {resultCount} ta natija
            {refreshing && ' · yangilanmoqda…'}
          </p>
        </>
      )}
    </div>
  )
}
