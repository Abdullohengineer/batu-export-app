## 2026-08-26 — Client role: RLS scoping, view-ownership RLS-bypass finding

Task: "create a profile for our client, Global Export" — a genuine customer-facing login/
dashboard, not a staff feature (§3.6, SPEC.md v1.37). Global Export Company is the one real,
active client on this project (79 pallets / 52,210 kg live), so this task touched real
production RLS from the first migration, not a sandbox — every step below was designed, then
confirmed with the user (per CLAUDE.md's "ask before applying migrations" rule) before
`apply_migration` was ever called, then verified live against a disposable TEST- account before
and after, per CLAUDE.md's testing-workflow rule.

**1. The `read_all` pattern is a real gap the moment a 6th, customer-facing role exists.**
Every operational table's SELECT policy, since day one (`0007_rls.sql`), is `read_all using
(auth.uid() is not null)` — literally any signed-in user sees every owner's rows. Correct while
all 5 roles are internal staff (all meant to see everything); not correct for a `client` role
account. Fixed with `alter policy read_all ... using (auth.uid() is not null and my_role() <>
'client')` on every table `client` shouldn't see everything on, plus a new owner-scoped policy
(`my_owner_id()`, a new `security definer` helper mirroring `my_role()`) added alongside for
every table `client` legitimately needs: `profiles`/`owners` (own row only), `kirim_orders`/
`kirim_lines`, `chiqim_requests`/`chiqim_lines`, `gate_weighings` (scoped via either `order_id`
or `request_id`, whichever direction), `storage_intake`/`moyka_sends`/`finished_pallets`/
`wash_cycles` (all keyed by serial, joined back through `kirim_lines`→`kirim_orders`),
`dispatch_manifest`, `lab_results` (scoped via `parent_serial` OR `wash_cycle_id`→`wash_cycles`
— confirmed via `get_serial_passport`'s own `cycle_lab` CTE that CHIQIM-scope rows carry
`wash_cycle_id`, not `parent_serial`), `raw_dispatch_lines`, `chiqim_line_pallets`/
`chiqim_line_raw_serials`, `serial_mint_sources` (needed so `kirim_line_state`'s own re-wash-
consumed exclusion stays *correct*, not just safe, for a `client` caller), `old_kn_pools`/
`old_kn_collections`. `notes`/`settings_limits`/`old_stock_closeouts`/`rezka_sends`/
`rezka_cycles` excluded outright, no replacement — no legitimate client use in this feature.
`product_categories`/`product_types`/`calibres` left untouched — pure reference data, no
per-owner sensitivity, needed for Tur/Kalibr labels the same way every other screen needs them.
`supabase/migrations/0083_client_role_rls_and_reporting.sql`. `profiles.owner_id` (nullable,
FK to `owners`) added in the same migration — set only for `role='client'` rows.

**2. `ALTER TYPE ... ADD VALUE` needed its own migration, applied first.** Postgres refuses to
use a freshly-added enum value inside the same transaction that added it — `'client'` appears
throughout migration 2's policies, so it had to land in a separate, prior migration
(`0082_client_role_enum.sql`) and a separate `apply_migration` call, not one file.

**3. The real finding — every `report_*_rows` view silently bypasses RLS, for every caller,
regardless of (1).** Suspected this while designing the client-facing reporting SQL (a Postgres
view's default `security_invoker = false` means row security on the view's own underlying
tables evaluates as the *view owner*, not the caller) and confirmed it live, empirically, rather
than trusting the reasoning alone: `select rolbypassrls from pg_roles where rolname =
'postgres'` → `true`; every `report_*_rows`/`stock_on_hand_rows`/`wip_rows`/`yield_rows` view
(`select viewowner from pg_views`) → `postgres`. Built a disposable TEST- client account
(`owners`/`auth.users`/`profiles` rows, `role='client'`, pointed at a throwaway TEST- owner, no
real data) and simulated its session directly (`set local role authenticated; set local
request.jwt.claim.sub = '<test-uuid>'`) — `select count(*) from kirim_orders` correctly
returned 0 (base-table RLS from step 1 working), but `select count(*) from report_kirim_rows`
returned **26** and `stock_on_hand_rows` returned **128** — every real row, every owner,
despite the account owning nothing. `get_client_report`/`report_query_page`, tested the same
way, happened to read back as empty — not because they were actually protected, but because
both separately re-join back to real, RLS-scoped `kirim_orders`/`owners` with an explicit
`owner_id` filter, an *incidental* protection specific to those two call paths.
`get_serial_passport`'s own `effectiveQty`/`gate`/`dispatches` sections pull straight from
`report_kirim_rows`/`report_chiqim_rows` with no such re-join and would have leaked any real
serial's data to a `client` caller who simply knew (or guessed — serials are sequential,
`DDMMYY-NNN`) the serial string; confirmed directly by calling `get_serial_passport('050826-
001')` (a real Global Export serial fetched via a privileged connection, deliberately not
selected through the client's own restricted session) as the TEST- client before the fix —
every section came back populated (later re-confirmed null after the fix, serial echoed back
verbatim since that field is a literal parameter echo, not derived from any row).

Fixed with `alter view <name> set (security_invoker = true)` on all 12 public views
(`report_kirim_rows`, `report_chiqim_rows`, `report_raw_dispatch_rows`, `report_old_kn_rows`,
`report_moyka_send_rows`, `report_moyka_output_rows`, `report_rows`, `report_rows_v2`,
`stock_on_hand_rows`, `wip_rows`, `yield_rows`, `old_stock_closeout_lines`) —
`supabase/migrations/0084_report_views_security_invoker.sql`. Re-verified live: the same
TEST- client now reads 0 from both `report_kirim_rows` and `stock_on_hand_rows`;
`get_serial_passport('050826-001')` as that client now returns every section null/empty (only
the literal `serial` echo survives). **Confirmed zero regression for the 5 staff roles** —
re-ran the identical queries as a real `menejer` account: `report_kirim_rows` 26,
`stock_on_hand_rows` 128, `kirim_orders` 25, unchanged before and after. This fix is
independent of the client-portal feature itself — it closes a latent gap in the existing
reporting layer that happened to be invisible until a less-trusted role existed to expose it,
and now protects `get_serial_passport`/`get_client_report`/`report_query_page` correctly for
any future role too, not just this one.

**4. Given (3), the new client-facing SQL deliberately does not depend on the view layer at
all**, even post-fix — belt-and-suspenders, and how the SQL itself makes the scoping claim
auditable at the point of use, not several layers away in a view's storage options.
`client_report_rows`/`client_calibre_split`/`client_serial_summary` (same migration as (1))
query base tables directly and call `my_owner_id()` inside the function body — no caller-
supplied `owner_id` parameter exists anywhere in this new SQL, so there is no argument a client
session could pass to see another owner's data even if every other layer failed. `kirim_line_state()`/`kirim_line_effective_qty()` (existing, reused unchanged for the Остаток
(сырьё)/Отгрузка columns) were individually checked via `pg_get_functiondef` before reuse and
confirmed to touch base tables only, no view in their call graph — safe to reuse as-is.

**5. Real bug caught by testing, not by review — undispatched pallets leaked into every date
range.** `client_report_rows`'s first draft used `(r.date_basis is null or r.date_basis between
p_from and p_to)` for the CHIQIM branch, copying the shape of the filter without copying its
actual behaviour. SPEC.md §3.2.3's own rule (row with no governing date → left out of the
date-ranged default, reachable only via an explicit status override) was dropped in translation
— and this client screen has no Holat filter at all (deliberately excluded per the task), so
there was no override path to reach anyway, meaning the bug had no correct escape hatch. Found
by building a real fixture (`TEST-RLS-001`, one KIRIM line + 2 finished pallets, no dispatch)
and reading the actual row count back: 5 rows returned including 2 `chiqim` rows with
`date_basis: null`, for a filter range of `2000-01-01`–`2100-01-01` — i.e. every possible range.
Fixed to `r.date_basis is not null and r.date_basis between p_from and p_to`, re-verified
against the same fixture: 3 rows (1 kirim + 2 moyka_output), matching what should actually be
visible. Shipped as a same-day corrective `create or replace function` (`client_report_rows_
date_basis_fix`, folded into the tracked `0083` migration file locally so a fresh `supabase db
push` reproduces the final, correct state directly — matching this repo's own stated convention
for a same-session fix, e.g. v1.20's yield/Rahbar-dashboard entry).

**6. `client_calibre_split(serial)` mirrors `kirim_line_state`'s own exclusion set exactly**
(drop re-wash-consumed / `bekor_qilindi` / `storage_loss` pallets), splitting by
`calibres.is_numberless` — the same flag `get_client_report`'s own `loss_output` CTE already
uses for calibre-vs-Konditirskiy. `calibre_kg + kn_kg` for a serial always equals
`kirim_line_state(serial).moykadan_chiqgan` for the same serial by construction (same CTE
shape, same filters) — not independently re-derived. Note: `is_numberless` is also true for
`RKN` (Rezka KN); Rezka has 0 live rows today (a separate, not-yet-used processing path per
SPEC.md), so this is untested in practice, flagged rather than silently assumed correct.

**7. Loss shown only once a wash is actually finished** (`wash_cycles.status = 'final'`) —
mirrors `yield_rows`' own "still-active serials are WIP, not yield yet" rule; a null `lossKg`
(shown as "ещё в переработке") rather than a misleading in-progress number. Basis matches
`yield_rows`, not `get_client_report`: actual, uncapped `moyka_sends` total minus real output —
the right basis for "how much did this specific serial actually lose," not a period balance
sheet's capped reconciliation figure.

**8. Naming collision caught immediately, before it reached a commit.** `Write`'d a new
`src/lib/clientReport.ts` for this feature without first checking whether the name was already
taken — it was: the existing §3.2.7 "Mijoz hisoboti" client-report types/export live there
already (`ClientReport`, consumed by `ClientReportTab.tsx`/`useClientReport.ts`/
`clientReportExport.ts`, a completely different feature — an internal Excel-export balance
document). `npx tsc -b --noEmit` immediately surfaced the break (`has no exported member named
'ClientReport'`) before any commit; `git status`/`git diff --stat` confirmed the file was
genuinely pre-existing and modified, not new. Restored via `git checkout --
src/lib/clientReport.ts`, new content moved to `src/lib/clientPortalReport.ts` instead, all
imports repointed. Recorded here as a caught-in-time mistake, not swept under the rug — the
project's `client`-prefixed naming space was already crowded by an unrelated, same-domain
feature, and a plain `git status` before trusting a `Write` result would have caught it a step
earlier.

**9. Storage bucket RLS — a known, flagged, NOT-closed gap.** `storage.objects` policies
(`kirim_photos_read`/`gate_photos_read`/etc., `select policyname, cmd, qual from pg_policies
where schemaname='storage'`) are `bucket_id = 'x' and auth.uid() is not null` — no per-owner
scoping, no path-prefix convention to scope by even if it were added here. A `client` account
that queried `storage.objects` directly (bypassing this app's UI entirely) could list or
`createSignedUrl` any object in `kirim-photos`/`gate-photos`/`intake-photos`/`lab-photos`,
not just its own. This app's own UI never asks for another owner's path (`client_serial_
summary` only ever returns the caller's own photo paths, itself owner-scoped per (4)), so the
exposure requires deliberately bypassing the app — lower practical severity than (3), but real.
Not fixed here: doing it properly needs the exact object-naming/path convention the upload code
(`KirimForm.tsx` etc.) actually uses, which wasn't investigated as part of this task, and a
rushed policy against an unconfirmed naming scheme risks being wrong in either direction. Flagged
per CLAUDE.md's scope-discipline rule rather than silently left for someone to discover later.

**10. No live-browser verification possible in this session — flagged, not silently skipped.**
This session's outbound HTTPS proxy denies a plain Chromium process direct access to
`*.supabase.co` (`gateway answered 403 to CONNECT`, confirmed via `$HTTPS_PROXY/__agentproxy/
status` — a policy denial, not a config problem to route around, per `/root/.ccr/README.md`'s
own explicit instruction not to retry these). `npx tsc -b --noEmit` is clean; every SQL object
was verified directly against the live database (sections 3, 5-7 above) via a disposable TEST-
account, including a real end-to-end pass with fixture data proving the exact numbers Global
Export would see are computed correctly. What was **not** done: actually loading `/client` in a
real browser and looking at it. A short visual pass (log in as a temporary client account,
confirm the table/filters/drill-down render and read correctly) is recommended before
considering this fully done, in an environment where that's reachable.

**Verification, summarized (full detail in sections 3, 5-7 above).** Disposable fixtures only
(`TEST-RLS-001` serial, `TEST-RLS-Verify-Owner`/`900000099` and a second `900000098` account
used only for the (blocked) UI check — both fully deleted afterward, confirmed via a follow-up
`select count(*)` on every touched table). Real Global Export data reconfirmed unchanged
throughout: 25 `kirim_orders`, 127 `finished_pallets`, 3 `owners`, before and after every
migration. `npx tsc -b --noEmit` clean (after fixing the `clientReport.ts` collision).

**Out of scope, flagged not fixed:** storage bucket RLS (item 9), Rezka/`RKN` interaction with
`is_numberless` splitting (item 6, untestable today — 0 live rows), live-browser hand-
verification (item 10, environment-blocked). Creating the real Global Export login itself —
explicit user decision, deferred; the `admin-users`/`Foydalanuvchilar` path is ready for
Menejer to use when ready.
