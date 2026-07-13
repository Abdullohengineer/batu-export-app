import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in your .env file (see .env.example).',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Dev-only: lets you run `supabase.from('kirim_orders').insert(...)` etc.
// directly in the browser console, signed in as whatever role you logged
// in as, to confirm RLS actually refuses/allows what it should.
// import.meta.env.DEV is a Vite build-time constant, so this branch is
// dead-code-eliminated from production builds — never shipped.
if (import.meta.env.DEV) {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase
}
