# BATU EXPORT — Build Decisions Log

Tracks decisions made during implementation that aren't already locked in `docs/SPEC.md`. Append-only; newest entry at the bottom of each section. If a decision later supersedes the spec itself, update `SPEC.md` and add a Changelog line there too.

Format per entry:

```
## YYYY-MM-DD — Short title
**Context:** why this came up
**Decision:** what was chosen
**Alternatives considered:** (optional)
```

---

## 2026-07-12 — Phase 0 scaffold choices
**Context:** Setting up the Vite + React + TS + Tailwind PWA shell per `PHASE0.md`.
**Decision:**
- Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first config, no `tailwind.config.js` needed) instead of the classic v3 PostCSS setup.
- `vite-plugin-pwa` (`registerType: 'autoUpdate'`) for the offline-first requirement (§2.6), rather than hand-writing a service worker.
- No router yet — `App.tsx` does a plain `session ? <HomePage /> : <LoginPage />` check. Role-based routing (§1.1, per-role home screens) is deferred to the auth/roles step, since adding `react-router-dom` now would be unused scaffolding.
- Auth state read via a small `useSession` hook wrapping `supabase.auth.getSession()` + `onAuthStateChange`, rather than a full context provider — revisit if more than one component needs session state.

## 2026-07-12 — Phase 0 database migrations
**Context:** Turning SPEC §8 + PHASE0 Part B into numbered SQL migrations in `/supabase/migrations`.
**Decision:**
- Followed PHASE0's file grouping but numbered/split it as 7 files so master data always precedes anything that references it: `0001_master_data`, `0002_serial`, `0003_operational`, `0004_storage`, `0005_notes_audit`, `0006_views`, `0007_rls`.
- `next_serial()` is `security definer` (search_path pinned to `public`) so it can write to `serial_counter` even though that table itself carries **no RLS policies at all** — the function is the only door in or out of it. Matches "the database is the source of truth" (§2.15) without opening a side channel.
- `my_role()` is also `security definer` so it can read `profiles` regardless of the caller's own row-level access.
- RLS is enabled on all 20 tables that exist after these migrations (not just the sample list PHASE0 spelled out), including `serial_counter`, `product_categories`, `product_types`, `calibres`, `settings_limits`, and `profiles`. Verified locally: with RLS on, a `rahbar`-role user is refused an `insert` into `kirim_orders`, and a `menejer`-role user succeeds — the exact test PHASE0 Part F asks for.
- `audit_log` SELECT is restricted to `rahbar` (not "any authenticated user") since it's raw compliance/oversight data with no operational screen reading it directly; every other operational table keeps the broad "any authenticated user can read" policy PHASE0 used, since Kuzatuv/traceability need cross-role visibility.
- Added `created_by uuid references profiles` to `gate_weighings` for consistency with the other operational tables (`kirim_orders`, `chiqim_requests`, etc. all record who created the row) — PHASE0's sample SQL omitted it, likely an oversight.
- SPEC §8's `USER_PREFS` (user_id, language) was **not** created as a separate table — `profiles.language` (from PHASE0's B1) already satisfies §2.8's per-user Uz/Ru toggle, and a second table would just be a duplicate write target.
- Smoke-tested all 7 migrations against a real local Postgres 16 instance (not just reviewed): they apply cleanly in order, `next_serial()` returns `DDMMYY-NNN` using Tashkent's date, `net_kg` computes as a generated column and can't be overridden by an insert, and the RLS refusal/success behavior above was verified with actual role-switching.
