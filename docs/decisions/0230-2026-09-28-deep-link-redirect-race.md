# Post-Rezka cleanup, item 4: the deep-link redirect race

Post-Rezka cleanup, HANDOFF item 4 (found by `rezka-hisobot` test 3, logged in `0226` §10).
Frontend only.

## The defect

A hard load of any deep route (a refresh, a bookmark, `page.goto('/menejer/hisobot')`) went
`/menejer/hisobot` → `/login` → `/menejer`, before the profile request was even sent. The cause
is a one-render race in `useProfile`:

1. On mount there is no session yet, so its effect sets `loading=false`.
2. `useSession`'s `getSession()` resolves and sets the session.
3. In that render `useProfile` still says `loading=false`: its fetch effect has not re-run.
4. `AuthProvider` reports "not loading, no profile", so `RoleRoute` redirects to `/login`.
5. The profile then arrives, and `/login` redirects to the role's home.

## Fix

`useProfile` derives `loading` instead of storing it. It records which user the current answer
belongs to (`loadedFor`: a user id, `null` for "no session", `undefined` before the first answer).
While a session exists, loading is simply `loadedFor !== session.user.id`.

So "session present, profile not yet loaded for this user" is loading by construction. That
covers:
- the first render after `getSession()`;
- a relogin as a different user, where the previous user's answer never counts.

A token refresh (a new session object for the same user) does not flash loading. A superseded
fetch is ignored.

The Supabase call's shape is unchanged. It was not moved onto `run()`: throwing on error would
change today's "no profile → login" behaviour.

## Verification

In a real browser (Chromium, Vite dev server, Supabase stubbed; this container has no test
credentials), with the same harness that reproduced the bounce before the fix. Each route was hard
loaded, and the profile response was delayed 0–1,500 ms to widen the race:

| Role | Route | Profile delay | Result |
|---|---|---|---|
| menejer | `/menejer/hisobot` | 0 ms | stays, Oddiy \| Rezka selector renders |
| menejer | `/menejer/hisobot` | 1,500 ms | stays |
| menejer | `/menejer/qoldiq` | 0 ms | stays |
| menejer | `/menejer/chiqim` | 800 ms | stays |
| rahbar | `/rahbar/hisobotlar` | 0 ms | stays |
| rahbar | `/rahbar/qoldiq` | 1,200 ms | stays |

No navigation passed through `/login`.

## Specs

- `rezka-hisobot` test 3 is back on `page.goto` for Hisobot and qoldiq, asserting the URL so a
  regression fails at the navigation.
- `hisobot-moykadan`, `hisobot-filter-debounce-consistency` and `moykada-yoqotish-invariant`
  already `page.goto('/menejer/hisobot')` after login and need no change; this fix is what they
  were missing.
- None of the four could be run here (no `.env.test`). They are in the local run command.
