# P0 recurrence: `0130`'s RLS caching fix was incomplete — bare `auth.uid()` left in every `read_all` policy

## Symptom

Hours after `0130` was applied and PR #161/#162 shipped, the user reported
the Rahbar dashboard and client Панель "Omborda hozir" section were **still**
hitting `canceling statement due to statement timeout` in production.

## Step 1 — was `0130` actually live?

Yes. Queried `pg_policies` directly: all 34 `client_read_own_*`/`read_all`
policies across the 17 tables show `(SELECT my_role())`/`(SELECT my_owner_id())`,
not bare calls. Not reverted, not a deploy gap.

## Step 2 — re-run EXPLAIN ANALYZE against live prod, right now

Both roles, both RPCs, full-year date range, `scope='hammasi'`:

| call | role | time |
|---|---|---|
| `rahbar_stock_snapshot` | rahbar | 804ms |
| `rahbar_stock_snapshot` | client | 1.19s |
| `rahbar_dashboard_ledger` | rahbar | 462ms |
| `rahbar_dashboard_ledger` | client | 891ms |

All fast, well under both the 8s (`authenticated`) and 3s (`anon`) timeouts
confirmed via `pg_roles.rolconfig`. **This alone doesn't mean the report was
wrong** — see step 3.

## Step 3 — was the test dataset representative of prod volume?

Checked row counts on every table either RPC joins: `kirim_orders` 32,
`kirim_lines` 33, `wash_cycles` 31, `finished_pallets` 265 (largest),
`chiqim_pallet_consumption` 99, everything else <30. Total table sizes
24–232kB. **Not a volume problem** — nothing here is large enough to cause
multi-second scans on its own, and bloat/dead-tuple ratios were checked too
(high dead *percentages* on some tables, e.g. `moyka_sends` 162%, but the
*absolute* dead-tuple counts are tiny, 2–47 rows — not a real vacuum/bloat
issue at this scale).

## Step 4 — re-run against the CURRENT merged code, not what was tested before

Same functions, same tables — confirmed via `pg_get_functiondef` that
`rahbar_dashboard_ledger`/`rahbar_stock_snapshot` are unchanged since `0130`.
No new "multi-cycle wash_cycles" code path was merged in main that these
RPCs don't already handle (the `cycles_all`/`active_cycle_at_to` CTEs with
`lead()` already existed pre-`0130` and handle multi-cycle correctly).

## Step 5 — statement_timeout confirmed

`pg_roles.rolconfig`: `anon` = 3s, `authenticated` = 8s, `authenticator`
(PostgREST's own connection) = 8s + `lock_timeout` 8s. Matches what the user
reported.

## The actual root cause: `pg_stat_statements` told the real story

A single fixed test case (fixed dates/scope/user) can't see variance.
Querying `pg_stat_statements` for the real, aggregate production call
history exposed it immediately:

| query | calls | mean | max | stddev |
|---|---|---|---|---|
| `rahbar_dashboard_ledger` (via PostgREST) | 822 | 858ms | **7302ms** | 876ms |
| `rahbar_stock_snapshot` (via PostgREST) | 799 | 537ms | **6766ms** | 727ms |

This is a fat right tail, not a constant slow query — `0130` measurably
improved the *mean* (matches its own before/after numbers) but did not
eliminate a tail that still occasionally exceeds both timeouts. Cross-checked
against `postgres_logs`: live `57014` (`statement_timeout`) cancellations are
still happening in real time, in bursts (10+ in a ~30s window, then quiet for
minutes) — consistent with intermittent lock contention, not a permanently
broken query.

**Found via `pg_policies` + Supabase's own performance advisor
(`auth_rls_initplan`, still WARN on all 17 `0130` tables post-fix):** every
`read_all` policy on those 17 tables reads

```sql
(auth.uid() IS NOT NULL) AND ((select my_role()) <> 'client'::user_role)
```

`0130` wrapped `my_role()`/`my_owner_id()` but left the **first** conjunct,
`auth.uid() IS NOT NULL`, completely bare. A single un-wrapped call anywhere
in a qual defeats Postgres's ability to treat the whole expression as a
cheap one-time filter — and `read_all` is evaluated on *every* read from
*every* role (including client reads, via OR-combined permissive policies,
even though it always evaluates false for a client), so this gap sits on
the exact same hot path `0130` was meant to close.

The advisor also caught two tables `0130` never touched at all:
**`calibres`** and **`product_types`** — plain lookup tables (`read_all` =
bare `auth.uid() IS NOT NULL`, no owner concept) joined directly by both
RPCs (`processed_calibre_total`/`processed_konditirskiy_total`, `byCalibre`,
`oldKnByType`), never in `0130`'s 17-table list because they're lookup
tables, not ledger tables — but still per-row-correlated once joined.

Separately confirmed (twice, via real `40P01 deadlock detected` errors when
attempting the fix) that there **is** live concurrent read/write traffic on
these exact tables right now — real contention exists on top of the
un-cached qual, which is exactly the combination that produces an
occasional multi-second tail on an otherwise-tiny (<300 row) dataset.

## Fix

`supabase/migrations/0131_complete_rls_auth_uid_caching_p0_followup.sql` —
wraps `auth.uid()` as `(select auth.uid())` in the same 17 tables' `read_all`
policy, plus `calibres`/`product_types`' `read_all`. Applied live.

Verified:
- `pg_policies` shows `(SELECT auth.uid())` on all 19 policies post-apply.
- Performance advisor re-run: `auth_rls_initplan` finding count dropped from
  31 to 12; the remaining 12 are exclusively on tables neither RPC
  touches (`audit_log`, `chiqim_fura_photos`, `chiqim_line_raw_serials`,
  `dispatch_manifest`, `notes`, `owners`, `product_categories`, `profiles`,
  `rezka_cycles`, `settings_limits`) — correctly still in `0205`'s deferred
  scope, not this hotfix's.
- Re-ran `EXPLAIN ANALYZE` role-switched, both roles, `hammasi`/`eski`
  scopes: 356ms–1.6s across 5 samples, no outlier reaching seconds.
- `rahbar_stock_snapshot('hammasi')` output re-checked for internal
  consistency (byType/byCalibre/oldKnByType sums align); absolute values
  have moved since `0130`'s snapshot because this is a live system with
  ongoing real transactions between the two checks — expected, not a
  regression (this migration changes performance only, not query logic).

🚩 **Cannot fully prove the tail is gone from a handful of manual samples
alone** — the original problem *was* a rare tail invisible to single-shot
testing. What's now confirmed: the specific mechanism that defeated the
`0130` cache (`auth.uid()` bare call) is closed, the advisor confirms zero
remaining un-cached quals on either RPC's dependency graph, and every
manual sample post-fix stayed under 1.7s. Recommend watching
`pg_stat_statements`/`postgres_logs` for `57014` recurrence on these two
queries specifically over the next real business day before considering
this fully closed.

## `0205` tech debt — scope reduced, not closed

Updated `0205` to reflect: `auth_rls_initplan` finding count is now 12
(was 31), confined to 10 tables outside both dashboard RPCs' dependency
graph. Still open, still its own PR later — just smaller than originally
scoped.
