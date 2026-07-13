import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'

export function RoleShell({ title, nav, children }: { title: string; nav?: ReactNode; children: ReactNode }) {
  const { profile } = useAuth()

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            BATU EXPORT — {title}
          </span>
          {nav}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {profile?.full_name ?? profile?.phone}
          </span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Chiqish
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
