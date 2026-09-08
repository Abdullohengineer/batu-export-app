## 2026-07-12 — Phase 0 scaffold choices
**Context:** Setting up the Vite + React + TS + Tailwind PWA shell per `PHASE0.md`.
**Decision:**
- Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first config, no `tailwind.config.js` needed) instead of the classic v3 PostCSS setup.
- `vite-plugin-pwa` (`registerType: 'autoUpdate'`) for the offline-first requirement (§2.6), rather than hand-writing a service worker.
- No router yet — `App.tsx` does a plain `session ? <HomePage /> : <LoginPage />` check. Role-based routing (§1.1, per-role home screens) is deferred to the auth/roles step, since adding `react-router-dom` now would be unused scaffolding.
- Auth state read via a small `useSession` hook wrapping `supabase.auth.getSession()` + `onAuthStateChange`, rather than a full context provider — revisit if more than one component needs session state.
