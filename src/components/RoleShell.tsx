import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

// Mobile-header fix (Qorovul gate redesign, mockup "BATU-Qorovul-Screens-
// v1_1.pdf"): the previous single-row `justify-between` layout had no
// responsive fallback at all -- title + nav + username + Chiqish all fought
// for one line and wrapped across three at phone width. Now: a compact top
// row (title without the "BATU EXPORT — " prefix below `sm`, username
// hidden below `sm`, Chiqish always present but tighter) with nav (when
// given) on its own row underneath, horizontally scrollable as a fallback
// rather than wrapping/overflowing. Shared by Qorovul, Ombor, and
// Laborator, so this fix reaches all three -- their own screen content is
// untouched.
export function RoleShell({ title, nav, children }: { title: string; nav?: ReactNode; children: ReactNode }) {
  const { profile } = useAuth()

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-3 py-2 dark:border-slate-800 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span className="hidden sm:inline">BATU EXPORT — </span>
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-[9rem] truncate text-sm text-slate-500 dark:text-slate-400 sm:inline">
              {profile?.full_name ?? profile?.phone}
            </span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 sm:px-3 sm:text-sm"
            >
              Chiqish
            </button>
          </div>
        </div>
        {nav && <div className="-mx-3 mt-2 overflow-x-auto px-3 sm:-mx-4 sm:px-4">{nav}</div>}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
