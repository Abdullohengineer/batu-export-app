import { supabase } from '../lib/supabase'
import { useSession } from '../lib/useSession'

export function HomePage() {
  const { session } = useSession()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-slate-50 px-4 dark:bg-slate-900">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        BATU EXPORT
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Kirildi: {session?.user.email}
      </p>
      <button
        onClick={() => supabase.auth.signOut()}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Chiqish
      </button>
    </div>
  )
}
