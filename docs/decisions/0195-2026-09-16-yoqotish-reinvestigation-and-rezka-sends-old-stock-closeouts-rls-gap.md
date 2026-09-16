# Yo'qotish re-investigation (no code defect found) + rezka_sends/old_stock_closeouts RLS gap closed

## What was reported

Client Приход's Yo'qotish (loss) column read blank on every row even with
"Boshidan" selected (full history — every finalized serial should show a
value). An earlier pass this session had concluded "working as designed,
period-scoping narrows the window" — user manually verified that
conclusion was wrong: with Boshidan selected the window covers every wash
cycle ever closed, so a genuinely-empty column across the board couldn't
be period-scoping.

## Re-investigation

Re-ran every layer end to end rather than re-reading code in isolation:

- `report_query_page`'s live `pg_get_functiondef`, column-position-counted
  by hand against its own `RETURNS TABLE(...)` — `kirim_line_loss_range(...)`
  lands correctly on `state_yoqotish` (position 46/57).
- Two role-switched SQL runs (`SET LOCAL ROLE authenticated` +
  `request.jwt.claim.sub`), one with `p_owner_id := NULL` and one with the
  TEST client's real owner id explicitly — both returned real, non-null
  `state_yoqotish` values (32, 302, 692, 685, 600, 737, 540, -55, 140, 220,
  58, 89, 242, 27, 74, 142 kg across the client's serials). Identical
  either way, ruling out an owner-scope-specific null-out.
- `reportQuery.ts`'s `mapState()`, `reportColumns.ts`'s column-key ordering
  (position-matched against the live function, not just name-matched),
  `useReportQuery.ts`'s `toRpcParams()`, and `formatLoss.ts` — all diffed
  against `origin/main` since this branch's own PR #140 merge commit
  (`937d8f5`); zero unaccounted-for change in any of them.
- `ClientPrihodTab.tsx`'s per-row render check
  (`row.state.yoqotish != null ? formatLossKg(...) : '—'`) — unchanged
  since `937d8f5`, confirmed by direct read of `origin/main`'s copy.

No defect found at the RPC, SQL-mapping, TypeScript-mapping, or rendering
layer. The one thing that changed in the right window: this branch's own
prior "Period-scope Moykada and Yo'qotish" commits (`190d48e`, `3c84a85`)
landed inside the exact ~1-day Netlify outage documented in
`0193-2026-09-15-netlify-build-break-root-cause-two-pre-existing-tsc-b-gaps.md`
(every build failed from PR #143's merge, Sep 14 2:33pm, through the
Sep 15 fix) — production was very likely still serving a pre-restoration
bundle when this was tested. **Conclusion: no code defect. Nothing shipped
for this column.** Flagged to the user as provisional pending a hard
refresh + retest against the current deploy, since this session's sandbox
cannot reach the live frontend to confirm directly (proxy denies the
Supabase/Netlify hosts — SQL/source verification only).

## Real, unrelated RLS gap found while auditing Fix 3 feasibility

`rezka_sends` and `old_stock_closeouts` both had only a `read_all` policy
(`my_role() <> 'client'` in its own definition — excludes the client role
entirely), no `client_read_own_*` counterpart. Same gap shape the original
client-role rollout closed for ~15 other tables; these two simply weren't
part of the client-facing surface until this round's Fix 3
(`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` reuse, which read both
through RLS, not through a `SECURITY DEFINER` self-scope).

Impact beyond Fix 3: `kirim_line_state()` — already backing the live
client Приход "Qabul qilingan"/"Omborda qoldi" columns — reads
`rezka_sends` directly. Without the policy a client caller always saw 0
rezka activity there, silently overstating Omborda qoldi by any real rezka
draw. Currently dormant (0 real rezka rows for the one real owner today)
but a live, real gap, not a hypothetical one.

Fixed via `supabase/migrations/0124_client_read_own_rezka_sends_old_stock_closeouts.sql`
(applied live):

- `rezka_sends`: join-through policy (`kirim_lines` → `kirim_orders` →
  `owner_id = my_owner_id()`), same shape as the existing
  `client_read_own_moyka_sends` policy — `rezka_sends` has no `owner_id`
  column of its own.
- `old_stock_closeouts`: direct-column policy (`owner_id = my_owner_id()`),
  same shape as the existing `client_read_own_old_kn_pools` policy.

## Verification

- `pg_policies` query confirms both policies registered.
- `rahbar_dashboard_ledger('2026-08-01','2026-09-16','yangi')` still runs
  clean under the client role post-migration (sane `raw` summary,
  `storageLossKg: 0` — consistent with 0 real `old_stock_closeouts` rows
  for this owner today, not a new error).
- `npx tsc -b`, `npx oxlint`, `npm run build` — all clean.
