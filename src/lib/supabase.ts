import { createClient } from '@supabase/supabase-js'
import { Preferences } from '@capacitor/preferences'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in your .env file (see .env.example).',
  )
}

// Auth session storage (2026-08-29, Prompt 12 — see DECISIONS.md "Ombor
// CHIQIM tab empty on APK, works on web"). Without an explicit `storage`,
// supabase-js defaults to `window.localStorage` — fine in a real browser
// tab, but not reliable on a genuine cold start in a fresh Capacitor
// Android WebView process, where a `localStorage.getItem()` read can race
// the WebView's own storage-backend initialization and return null even
// though a session WAS persisted. App.tsx's AppRoutes already gates all
// rendering on useAuth().loading (nothing mounts before getSession()
// resolves), which protects against a LATE answer but not a WRONG one —
// every RLS `read_all` policy in this app (chiqim_requests included)
// requires `auth.uid() IS NOT NULL`, so a falsely-null session silently
// returns zero rows everywhere, with no error, indistinguishable from "no
// data" in the UI. `@capacitor/preferences` (already a project dependency,
// already used by usePrinter.ts for printer settings) is backed by
// Android's native SharedPreferences — synchronously available from
// process start, no WebView-storage race — and is Supabase's own
// documented recommendation for Capacitor apps. Its web implementation
// uses localStorage under the hood, so this is a no-op behavior change on
// the web build, not a native-only special case.
const capacitorAuthStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value })
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key })
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: capacitorAuthStorage,
    // No OAuth/magic-link flow exists (only signInWithPassword, confirmed
    // via a repo-wide grep) — there is no redirect URL to parse, and
    // parsing `window.location` for auth params has no meaning inside a
    // Capacitor WebView loading local bundled assets.
    detectSessionInUrl: false,
  },
})

// Dev-only: lets you run `supabase.from('kirim_orders').insert(...)` etc.
// directly in the browser console, signed in as whatever role you logged
// in as, to confirm RLS actually refuses/allows what it should.
// import.meta.env.DEV is a Vite build-time constant, so this branch is
// dead-code-eliminated from production builds — never shipped.
if (import.meta.env.DEV) {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase
}
