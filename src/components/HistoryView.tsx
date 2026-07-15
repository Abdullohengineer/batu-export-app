import type { ReactNode } from 'react'

// Shared shell for a role's Hisobotlar (history) view: a filter bar, a
// results area, and empty/loading states. Deliberately NOT a generic table
// framework — each role plugs in its own filter controls, its own data hook,
// and its own result rows/columns. This is the piece Laborator's Hisobotlar
// will reuse later (Phase 4): a new role adds its own filters + hook + rows,
// not a new shell.
export function HistoryView({
  filters,
  loading,
  isEmpty,
  emptyText,
  resultCount,
  children,
}: {
  filters: ReactNode
  loading: boolean
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

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : isEmpty ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <>
          <div className="space-y-2">{children}</div>
          <p className="text-xs text-slate-400">{resultCount} ta natija</p>
        </>
      )}
    </div>
  )
}
