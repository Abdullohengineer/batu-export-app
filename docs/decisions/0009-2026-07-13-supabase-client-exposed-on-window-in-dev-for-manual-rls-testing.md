## 2026-07-13 — Supabase client exposed on window in dev, for manual RLS testing
**Context:** Needed a fast way to run ad-hoc `supabase.from(...).insert(...)` / `.select(...)` calls from the browser console — signed in as whatever role is currently logged in — to manually confirm RLS actually refuses/allows what §2.12 and `0007_rls.sql` say it should, without writing a throwaway test harness for it.
**Decision:** In `src/lib/supabase.ts`, added:
```ts
if (import.meta.env.DEV) {
  (window as unknown as { supabase: typeof supabase }).supabase = supabase
}
```
right after the client is created, marked `TEMPORARY DIAGNOSTIC` (search that string to find/remove it later, same convention as the Edge Function markers above). `import.meta.env.DEV` is a Vite build-time constant, so this isn't just hidden behind a runtime check — verified the production build (`npm run build`) contains **zero** trace of `window.supabase` or the `DEV` branch (Vite dead-code-eliminates it entirely), and separately confirmed in a running dev server that `window.supabase.from` is actually callable. Nothing here changes what the anon-key client is allowed to do — RLS is still the only thing standing between this console access and the database, which is the whole point of exposing it this way rather than, say, a debug-only service-role shortcut.
