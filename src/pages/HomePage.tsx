import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/useProfile'
import { UsersAdminPage } from './admin/UsersAdminPage'

export function HomePage({ profile }: { profile: Profile }) {
  const [view, setView] = useState<'home' | 'users'>('home')

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">BATU EXPORT</span>
          {profile.role === 'rahbar' && (
            <nav className="flex gap-2 text-sm">
              <button
                onClick={() => setView('home')}
                className={view === 'home' ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}
              >
                Bosh sahifa
              </button>
              <button
                onClick={() => setView('users')}
                className={view === 'users' ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}
              >
                Foydalanuvchilar
              </button>
            </nav>
          )}
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Chiqish
        </button>
      </header>

      {view === 'users' && profile.role === 'rahbar' ? (
        <UsersAdminPage />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Kirildi: {profile.full_name ?? profile.phone} ({profile.role})
          </p>
        </div>
      )}
    </div>
  )
}
