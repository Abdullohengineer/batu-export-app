# Post-Rezka cleanup, item 1: passport, snapshot and ledger under RLS

Post-Rezka cleanup, HANDOFF item 1. Migration `0147_staff_definer_passport_snapshot_ledger.sql`
applied 2026-09-28 (version `20260928121525`). Stored md5 is `7efbb82e478f8c6135078da2006e3cec`,
matching the file (8,107 bytes). Builds on `0202`/`0205`–`0207` (the RLS caching sweep) and `0226`
§10 (where this was found).

## Diagnosis

Each function body was run through `EXPLAIN ANALYZE` inline, with its parameters bound. Times are
from a warm second run, planning + execution:

| Function | `postgres` (no RLS) | Rahbar | Client |
|---|---|---|---|
| `get_serial_passport_core` | 44 + 18 ms | 5,140 + 5,687 ms | 3,658 + 4,940 ms |
| `rahbar_stock_snapshot_core` | 11 + 28 ms | 181 + 232 ms | 136 + 995 ms |
| `rahbar_dashboard_ledger` | 24 + 20 ms | 243 + 186 ms | 131 + 474 ms |

**The cost is RLS itself.** Every table reference expands both policies, `read_all` and
`client_read_own_*`, and the client branches nest EXISTS joins through `kirim_lines`,
`kirim_orders` and `finished_pallets`. The result is hundreds of InitPlans per statement, most
never executed but all planned.

**Not re-planning.** A PL/pgSQL copy of the passport body returned an identical result and was no
faster.

**The v1.58 `(select my_role())` rewrite is spent.** It has been schema-wide since `0130`–`0133`,
with advisor findings at 0, so it can't help further.

## Fix: security definer behind an explicit role check (one pattern, all three)

| Name | What it is |
|---|---|
| `<fn>_rls` | The current function, renamed. Invoker; RLS applies. |
| `<fn>_staff` | `SECURITY DEFINER`, `search_path=public`. Refuses (42501) unless `auth.uid()` is set and `my_role()` is not `client`, the `read_all` predicate itself. Then runs `<fn>_rls` as owner, so RLS is bypassed. |
| `<fn>` | Public name, plpgsql router. Authenticated non-client callers go to `_staff`; client, anon, `service_role` and `postgres` go to `_rls`, exactly as before. |

**Why staff results are identical to before.** Every table reached has a permissive SELECT policy
of either `auth.uid() is not null and my_role() <> 'client'` or `auth.uid() is not null`, so a
non-client already saw every row. This covers:
- the three bodies;
- their helper functions: `chiqim_departed_at`, `chiqim_fura_photo_paths`,
  `chiqim_request_loaded_kg`, `report_kirim_rows_as_of`, `rezka_serial_is_test`,
  `rezka_serial_state_set`;
- all 20 views.

The schema-wide check found only three tables outside that pattern: `audit_log` (Rahbar-only),
`serial_counter` and `partiya_counter`. The call-graph walk and the view definitions reach none
of them.

**Client behaviour.** Unchanged by design. The client portal's Панель is scoped purely by RLS
(`ClientPanelTab.tsx`) and keeps that path.

**Grants.**
- The public names keep the default grants.
- `_staff` has EXECUTE for `authenticated` and `service_role`; revoked from PUBLIC and anon.
  Verified live: anon has no EXECUTE, `search_path` is pinned, `prosecdef` is true.
- A client calling `_staff` directly is refused with 42501, verified live.

## Addition: plan-independent `byCalibreType.dispatched`

The dry run's single hash mismatch was `rahbar_dashboard_ledger`'s `byCalibreType.dispatched`: the
same elements in a different order. It was a `jsonb_agg` without ORDER BY, and bypassing RLS
changes the plan.

0147 adds `order by type_id, calibre_id` inside `rahbar_dashboard_ledger_rls`, as a checked text
edit of the live 0143 body, not a retype:
- the body must hash to `178696381ebb22ab4801942952fc7bb0`, or the migration aborts;
- the target line must occur exactly once, or the migration aborts.

**Verification after apply.** The pre-0147 body was rebuilt from the live one with the ORDER BY
removed; it hashed exactly to `17869638…`. For Rahbar and client, over this month, from 2026-07-15
(Hammasi) and Eski:
- every key except `dispatched` is equal;
- `processed` is equal;
- `dispatched` is the same set.

So the only output change anywhere is `dispatched` element order. Both dashboards regroup and sort
it by kg (`computeDashboardDerived`), so nothing on screen changes.

`byCalibreType.processed` still has no ORDER BY. It matched in every comparison, but it is equally
plan-dependent. Left as is; flagged.

## Timings (live, after apply)

| Call | Rahbar before (RLS) | Rahbar after | Client before | Client after (unchanged path) |
|---|---|---|---|---|
| passport `150726-001` | 14,977 ms (first call) | 135 first / 61 warm | 1,806 | 2,952 |
| passport `280926-017` | 2,038 | 66 / 58 | 1,257 | 1,832 |
| snapshot yangi / eski / hammasi | 283 / 211 / 278 | 34 / 25 / 34 | 376 / 189 / 325 | 332 / 180 / 304 |
| ledger yangi (this month) | 340 | 88 | 419 | 417 |
| ledger hammasi (from 2026-07-15) | 325 | 97 | 478 | 485 |
| ledger eski (from 2026-07-15) | 91 | 14 | 212 | 183 |

Output hashes, before vs after: every passport and snapshot is identical for both roles. The
ledger differs only by the `dispatched` order above.

**The client passport stays slow**, 1.3–7.6 s across runs. The client portal never opens a
passport, so this is left.

## Process note

The first dry run, one combined transaction, exceeded the MCP tool's 60 s limit. The backend kept
running, so it was cancelled with `pg_cancel_backend`. Nothing had committed: none of the new
functions existed afterwards. It was re-run as three smaller rolled-back transactions.
