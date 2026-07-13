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

## 2026-07-12 — Auth method: phone number, not email
**Context:** BATU has no SMS provider budget and no real inboxes for staff logins — an email-based flow (verification links, password reset) doesn't work for a warehouse/gate/lab workforce logging in by phone.
**Decision:**
- Login screen collects **phone number + password**. Under the hood this is still Supabase email/password auth: the phone is converted to a synthetic address `<digits>@batu.local` (see `src/lib/phoneAuth.ts`, shared by the login screen and the admin function) before calling `signInWithPassword` / `createUser`. No SMS provider, no per-login cost.
- **Consequence:** Supabase's built-in "forgot password" (magic link to a real inbox) is unusable — there is no inbox behind `@batu.local`. No self-service signup or forgot-password UI was built; public signup stays disabled (Supabase Auth setting, outside this repo). The login screen shows a static "contact Rahbar" hint instead.
- Replacement: a Supabase Edge Function (`supabase/functions/admin-users`) using the `service_role` key, is the only way to create a user or reset a password. It checks the caller's own JWT, looks up their `profiles.role`, and returns 403 unless it is `rahbar` and `active` — enforced in the function itself, not just by hiding the "Foydalanuvchilar" screen (§2.12's server-side-enforcement principle, applied to admin actions too).
  - `create_user`: `{ phone, password, role, full_name }` → `auth.admin.createUser` + matching `profiles` insert (with the new `profiles.phone` column added in `0008_profiles_phone.sql`, used to look users up by the number they actually log in with). If the `profiles` insert fails, the orphaned auth user is deleted so a retry with the same phone doesn't collide — this is an admin API cleanup of Supabase's own `auth.users`, not a `DELETE` against any of our operational tables, so it doesn't break the "never DELETE, only void" house rule (§2.15).
  - `reset_password`: `{ phone, new_password }` → looks up the id by `profiles.phone`, then `auth.admin.updateUserById`.
- Added a **"Foydalanuvchilar"** nav item + screen (`src/pages/admin/UsersAdminPage.tsx`), visible only when `profile.role === 'rahbar'`, with the two forms above calling the Edge Function via `supabase.functions.invoke`.
- This is the first role-gated screen, so `App.tsx`/`HomePage.tsx` now fetch the caller's `profiles` row (`useProfile` hook) after login. Still no router — the rahbar's home/users toggle is local `useState`, same reasoning as the earlier "no router yet" decision. Full per-role home screens and a route guard are still deferred to the dedicated auth/roles step.

## 2026-07-12 — Routing: react-router-dom, one route tree per role
**Context:** Implementing per-role home screens (SPEC §1.1) and a route guard, now that there's more than one screen (`HomePage` + the rahbar-only Foydalanuvchilar admin page). The earlier "no router yet" decision was explicitly scoped to "revisit when more than one component needs session state" — this is that point.
**Decision:**
- Reintroduced `react-router-dom`. `App.tsx` now wraps everything in `AuthProvider` (a small context wrapping `useSession` + `useProfile` so both are fetched once, not once per page) and a `<Routes>` tree.
- One placeholder home route per role: `/rahbar`, `/menejer`, `/qorovul`, `/ombor`, `/laborator`. `/rahbar` is a nested route (`RahbarLayout` + `Outlet`) so `/rahbar/foydalanuvchilar` (the existing admin screen) shares its header/nav; the other four roles have nothing to nest yet, so they're flat routes for now.
- `RoleRoute` (`src/routes/RoleRoute.tsx`) is the guard: it reads `profile.role` from `useAuth()` and renders `<Navigate to={\`/${profile.role}\`} />` if the current route's `allow` list doesn't include it — e.g. a `qorovul` hitting `/ombor` bounces straight to `/qorovul`. Logged-out users bounce to `/login`.
- `/` and any unmatched path redirect to the caller's own role home (or `/login` if signed out); `/login` itself redirects to the role home if already authenticated, so there's no dead end in either direction.
- 🔒 This client-side guard is a UX nicety, not the security boundary — the actual enforcement is server-side RLS (§2.12, `0007_rls.sql`), which already refuses cross-role writes regardless of what the UI lets you navigate to.
- Extracted the shared header/sign-out chrome all five role pages needed into `src/components/RoleShell.tsx`, and deleted the old single `HomePage.tsx` now that each role has its own page.

## 2026-07-13 — admin-users Edge Function wired up; action names finalized
**Context:** Wiring the Foydalanuvchilar screen to the Edge Function for real instead of leaving it a placeholder.
**Decision:**
- Renamed the function's actions from the earlier `create_user` / `reset_password` to **`create-user`** / **`reset-password`** to match the naming actually specified for this function; nothing else in the codebase referenced the old names, so this was a clean rename.
- `reset-password` now accepts **either** `{ phone, new_password }` or `{ user_id, new_password }` — not phone-only as originally built. The Foydalanuvchilar reset form takes a single "phone or user ID" field and picks which key to send based on whether the input matches a UUID pattern; the function looks up the `profiles` row by phone first only when `user_id` wasn't given directly.
- Re-confirmed the server-side rahbar check is the actual security boundary here, not just the frontend route guard from the previous entry: the function reads the caller's own JWT via `admin.auth.getUser(jwt)`, looks up *their* `profiles.role`, and 403s before looking at the request body at all if it isn't `active` `rahbar` — so hitting the function directly (curl, a modified frontend, another role's session) is refused the same way a UI click would be.
- Verified end-to-end except for the parts that require a live Supabase project (which this sandbox can't reach — see the earlier network-policy note): `npm run build`/`lint` clean, and a headless-browser smoke test confirms the app still boots and renders `/login` with no console errors after the change. The actual create-user / reset-password round trip against real Auth + `profiles` still needs to be clicked through once migrations are applied and a first rahbar account exists.
