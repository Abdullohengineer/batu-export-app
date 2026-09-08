## 2026-08-29 — Ombor CHIQIM tab empty on APK, works on web

**Symptom (task's own report):** Ombor role sees no active CHIQIM requests on the APK build,
same account/backend shows the request fine on web.

**Investigation report (per task's own 4 required questions), before any fix:**

1. **What the hook queries.** `useOmborChiqimRequests.ts` selects from `chiqim_requests`
   filtered server-side only by `.is('voided_at', null)` (plus a separate `gate_weighings`
   query joined client-side by `request_id`). No `.eq('owner_id', ...)` or other client-side
   role/ownership filter exists in this hook at all — RLS does all the row-scoping. Confirmed
   the mapped fields (`id, request_date, plate, driver, owner_id, ombor_finished_at,
   chiqim_lines(...)`) reference none of `closed_at`, `partiya_no`, or any new `line_kind`
   value that a stale-type client build could silently mis-map — ruling out "client-side type
   mismatch dropping rows" as the mechanism for THIS hook specifically.
2. **Auth/role availability on cold start.** `src/lib/supabase.ts` had zero custom
   `auth.storage` config, so `supabase-js` defaulted to `window.localStorage`. `App.tsx`'s
   `AppRoutes()` gates all rendering on `useAuth().loading` (`if (loading) return null`),
   which itself is gated on `useSession()`'s `getSession()` promise — so no screen, including
   `OmborChiqimTab`, mounts before `getSession()` resolves. That protects against a LATE
   answer, not a WRONG one: `localStorage.getItem()` inside a fresh Capacitor Android WebView
   process is a documented race against the WebView's own storage-backend init and can
   legitimately return `null` even though a session was persisted from a prior app session —
   `getSession()` then resolves "successfully" to `session: null`, `loading` flips false, and
   the app renders as logged-out-shaped-like-empty rather than erroring.
3. **RLS behavior under an unresolved/null `auth.uid()`.** Queried `chiqim_requests`' live
   policies via Supabase MCP: the policy Ombor's own read relies on is `read_all`
   — `(auth.uid() IS NOT NULL) AND (my_role() <> 'client')`. No recent change to this policy
   was needed to explain the symptom — a null `auth.uid()` under this existing, unchanged
   policy silently returns zero rows, with no error, which is exactly indistinguishable from
   "no active requests" in the UI. This is the same silent-empty-not-error shape CLAUDE.md's
   origin-filtering section warns about for a different mechanism (filters vs. session), and
   it produces an identical-looking symptom.
4. **Client-side filters on new fields.** None found (see point 1) — `useOmborChiqimRequests.ts`
   was already updated in the prior prompt (2026-08-29, "Menejer CHIQIM: quantity-only entry,
   no tara") to drop the one field (`declared_tara_kg`) that had recently changed shape; no
   other new/renamed field is read by this hook's query or mapping.

**Ranked suspects (by findings, not guesses):**

1. **Auth session storage adapter gap — root cause, high confidence.** No `auth.storage`
   override existed; `@capacitor/preferences` (already a project dependency, already used
   elsewhere in the codebase for `usePrinter.ts`'s printer-selection persistence, confirmed
   via a repo-wide grep — the only other call site) was never wired into the Supabase client
   at all. This is Supabase's own documented recommendation for Capacitor apps specifically
   because `localStorage` is unreliable in a WebView on cold start, and it exactly matches the
   reported "works on web, empty on APK, same account" symptom (web has no such race; APK
   does).
2. **Stale native JS bundle — cannot rule in or out from this environment**, same standing
   limitation as the prior precedent (2026-07-26, "QR 'didn't apply': stale native bundle, not
   a code gap"): `dist-native`/`android/app/src/main/assets/public/` is git-ignored and only
   populated by `npm run build:native && npx cap sync android` run locally by whoever builds
   the APK; a Java-only rebuild ships stale JS silently. No source-code fix applies to this
   suspect — flagging it, not fixing it, per the task's own instruction ("if it's a stale
   bundle, no code fix — just document the build command"). **If the fix below does not
   resolve the symptom on-device, rebuild with `npm run build:native && npx cap sync android`
   before re-testing** — do not assume a Java/Gradle-only rebuild picked up this change.
3. **Type mismatch / `.env` divergence — ruled out** by direct inspection (points 1 and 4
   above for the type-mismatch path; `vite.config.ts`'s native/web build modes resolve
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` through the identical `import.meta.env`
   mechanism, no mode-specific env handling exists in the repo). The user's actual local
   `.env` file contents are outside this environment's visibility, so this isn't fully
   closed at the credentials-value level, only structurally de-risked at the build-config
   level.

**Fix applied.** `src/lib/supabase.ts`: added a `Preferences`-backed `auth.storage` adapter
(`getItem`/`setItem`/`removeItem` wrapping `@capacitor/preferences`'s `get`/`set`/`remove`) to
`createClient()`'s options, backed by Android's native `SharedPreferences` — synchronously
available from process start, no WebView-storage race. Its web platform implementation uses
`localStorage` internally, so this is a no-op behavior change on the web build, not a
native-only special case; nothing else changes for web users. Also set
`detectSessionInUrl: false` — confirmed via grep that only `signInWithPassword` is used
anywhere in `src` (no OAuth/magic-link flow), so there is no redirect URL to ever parse, and
parsing `window.location` has no meaning inside a Capacitor WebView loading local bundled
assets.

**Verified:** `npx tsc --noEmit`, `npm run build` (web), `npm run build:native` (confirms the
`@capacitor/preferences` import resolves correctly under both Vite build modes), `npx oxlint`
all clean. `node --test`: 67/67, unchanged (a client-config wiring change, no new
pure-function logic to cover).

**Testing (task's own "cold-start APK on floor phone, verify web still shows correctly"):**
not run this session — this remote environment has no physical Android device or emulator to
install an APK on, a different limitation from (but analogous in spirit to) the standing
"no `.env.test`" disclosure in every prior prompt. Flagged, not silently skipped. Whoever picks
this up next should: rebuild native (`npm run build:native && npx cap sync android`), install
on a floor phone, force-stop the app (or reboot the device) to guarantee a genuine cold start
(not just backgrounding, which CapacitorUpdater's `atBackground` mode already handles
separately), log in as an Ombor test account, open the CHIQIM tab, and confirm the active
request now appears; then confirm web (`npm run dev` or the deployed Netlify build) still
shows the same request, to rule out a regression from the `detectSessionInUrl: false` change.

**Out of scope, untouched:** `chiqim_requests` RLS policies (read, not modified — confirmed
correct as-is, the bug was client-side session hydration, not policy logic);
`useOmborChiqimRequests.ts` (read, not modified — confirmed it does not contribute to the
symptom); any other Supabase client instantiation (only one `createClient()` call exists in
the codebase, in `supabase.ts`).

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/global-export-profile-setup-t1hl6t`.
