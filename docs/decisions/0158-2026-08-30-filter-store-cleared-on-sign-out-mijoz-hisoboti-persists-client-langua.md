## 2026-08-30 — Filter store cleared on sign-out; Mijoz hisoboti persists client + language

Follow-up to "Filter persistence across tab switches" above, prompted by reviewing the
competing implementation in PR #125 (closed as superseded — see below).

**The correction.** That review turned up a claim of mine that was wrong. I said the
in-memory filter store dies with `AuthProvider` on logout, so an owner-scoped filter would
be safe to persist. It does not. `FilterStateProvider` is mounted *inside* `<AuthProvider>`
(`src/App.tsx:41-48`), but `AuthProvider` never unmounts on sign-out — it is the component
that *holds* the session, and `useSession` merely flips its own state on
`onAuthStateChange`. So the ref'd `Map` survives a logout/login on the same page load, and
whatever the previous user filtered by is handed to the next one.

For the eight keys already in use that is invisible (a date range, a column picker). For an
owner-scoped filter it is not: Mijoz hisoboti's client select decides *whose* balance
document is on screen.

**Fix.** `FilterStateProvider` now subscribes to `supabase.auth.onAuthStateChange` and
clears the map on `SIGNED_OUT`. Keyed on the event, deliberately, and **not** on
`useAuth()`'s `profile`: that value is null during every loading window by design (see the
`resolvedProfile` note in `AuthProvider.tsx`), so watching it would wipe filters on ordinary
profile refetches. Both sign-out call sites (`AppNavShell.tsx:55`, `RoleShell.tsx:31`) go
through `supabase.auth.signOut()`, so one subscription covers them and any future third
call site without needing to find it.

**Then** `ClientReportTab` persists all four of its filter-bar values —
`clientReport.ownerId`, `.from`, `.to`, `.locale` — where before only `.from`/`.to` were
persisted. §3.2.7 has no other browsable state, so that is the whole bar.

**Why this came from #125.** PR #125 was an independent implementation of the same
filter-persistence feature by a separate session (branch
`claude/global-export-profile-setup-t1hl6t`), landing a module-scope `Map` in
`src/lib/usePersistedState.ts` across 5 screens. It went un-mergeable the moment PR #124
merged, and resolving it would have left the app with two unrelated persistence stores side
by side, screens split arbitrarily between them. Closed as superseded rather than merged.
Its one behavioural delta over #124 — persisting `ownerId` and `locale` on Mijoz hisoboti —
is the part worth keeping, and is what this entry implements. Note that #125 would have
shipped that delta *with* the cross-logout leak, since a module-scope Map outlives sign-out
even more thoroughly than this one did.

**Verified:** `tsc -b` clean, `oxlint` clean (the one pre-existing
`react(only-export-components)` warning on `FilterState.tsx`, unchanged — confirmed present
on `main` before this diff), `vite build` clean, 72/72 unit tests pass.

⚠️ **Sign-out clearing is not verified in a browser.** Same blocker as the parent entry:
this clone has no `.env`, so the app cannot bootstrap against Supabase and no login/logout
cycle can be driven. The mechanism is a single `onAuthStateChange` subscription clearing a
`Map`; it has not been watched doing so against a real session. Flagged rather than glossed
— this is the check to run first when an environment with credentials is available.
