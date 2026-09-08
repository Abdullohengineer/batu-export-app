## 2026-08-26 — `admin-users` Edge Function never actually deployed; Global Export's real login created

PR #107 merged (user's own action, not this session's). User then reported "i can't create
client from Rol on creating new user." Root cause, confirmed directly: `admin-users`'s *source*
was updated in that PR (`ALLOWED_ROLES` gained `'client'`, `owner_id` handling added) and
committed to git, but an Edge Function's deployed code is a separate artifact from its source
file — nothing in this project's workflow re-deploys it on merge, and this session never called
`deploy_edge_function` after editing it. `get_edge_function('admin-users')` confirmed the live
function was still version 14, `ALLOWED_ROLES = ['rahbar', 'menejer', 'qorovul', 'ombor',
'laborator']` verbatim — `'client'` was never actually reachable, in production, despite the
merged PR. Fixed by deploying the current local source as-is (`deploy_edge_function`, same
`verify_jwt: false` as the existing live config) — now version 15, `ALLOWED_ROLES` includes
`'client'`. `Foydalanuvchilar`'s Rol dropdown/owner picker should work end-to-end from here.

**Follow-up, same day: login actually failed with an opaque `{}` error — the direct `auth.users`
insert above was incomplete.** User reported the new login didn't work. Root cause, found by
diffing every column of Global's `auth.users` row against a real, properly-created account's
(`select ... from auth.users u cross join auth.users r cross join lateral
jsonb_object_keys(to_jsonb(u))... where (to_jsonb(u)->>col) is distinct from
(to_jsonb(r)->>col)`), two real gaps, both well-known Supabase/GoTrue gotchas for a hand-rolled
`auth.users` insert that a proper `admin.auth.admin.createUser()` call (what the Edge Function
actually does) never hits:
1. **No matching `auth.identities` row.** `admin.auth.admin.createUser()` always creates one;
   raw SQL against `auth.users` alone does not, and GoTrue's password-grant flow needs it.
   Confirmed 0 rows for Global's `provider_id` where a reference account had exactly 1
   (`provider='email'`, `identity_data` = `{sub, email, email_verified, phone_verified}`,
   `email` itself a *generated* column — inserting it explicitly fails outright). Backfilled
   the missing row.
2. **Four text columns (`email_change`, `recovery_token`, `confirmation_token`,
   `email_change_token_new`) were `NULL` instead of `''`.** GoTrue's Go code treats these as
   non-nullable strings internally; a genuine `NULL` here is a documented cause of the exact
   kind of opaque, non-`AuthError`-shaped failure the user saw. Backfilled to `''`;
   `raw_user_meta_data` also aligned to `{"email_verified": true}` to match every real account.

**Neither of these was actually verified before the original creation** — RLS testing throughout
this whole feature (both the disposable TEST- accounts and this real one) used `set local
request.jwt.claim.sub` to simulate a session directly against Postgres, which exercises RLS
correctly but never exercises GoTrue's own password-grant login path at all. This diff-against-
a-real-account technique is the closest verification available without a working browser in this
session (still blocked, see the immediately-prior entry's item 10) — high confidence, not a
live-tested certainty. If login still fails after this, the next step is comparing the two rows
again for anything this pass missed, not re-guessing.

**Global Export's real login created** (name **Global**, phone-login `998911110101`, password
`0101` — all values given directly by the user), `role='client'`, `owner_id` = the real Global
Export Company row (confirmed by joining back to `owners` after insert: `owner_name = "Global
Export Company"`). Created directly via SQL (same `auth.users`+`profiles` insert shape the Edge
Function itself performs — `phoneToAuthEmail`, `email_confirm`/`email_confirmed_at` set,
`crypt()`-hashed password) rather than through the now-fixed Edge Function, since this session
has no menejer session JWT to call it with. **This is real, permanent production data — not a
TEST- fixture, not cleaned up.** Confirmed no pre-existing collision on that phone number before
inserting. Note: `0101` is a weak, easily-guessed password for a customer-facing login; not
changed unilaterally since the user specified it directly, but worth a stronger one if this
account is handed to the actual client rather than kept for internal use.
