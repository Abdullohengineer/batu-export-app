# Phase 3 Stage A: dashboard RPCs rewritten set-based (swapped in place)

Acts on `0213`'s finding that the two dashboard RPCs account for **100% of
the remaining statement timeouts**. `0212` had deliberately excluded them;
new data justified the re-scope.

## Why Stage A / Stage B, and why Stage A is contained

A full source scan of every function and view found:

| object | DB dependants | live frontend callers |
|---|---|---|
| `rahbar_stock_snapshot` | **0** | `useRahbarDashboardV2` → RahbarHome, ClientPanelTab |
| `rahbar_dashboard_ledger` | **0** | same |
| `stock_on_hand_rows` | **5** | — |
| `kirim_line_moyka_asof` | **3** | — |

The two RPCs have **zero database dependants**, so rewriting their bodies
cannot affect anything else. `stock_on_hand_rows` is the shared one — its 5
callers are `client_old_stock_breakdown`, `client_panel_summary`,
`get_serial_passport`, `rahbar_exceptions`, `rahbar_stock_snapshot`, of which
only `rahbar_exceptions` (MenejerExceptionsTab) and `get_serial_passport`
(SerialPassportModal) have live frontend callers. Touching it is **Stage B**,
and only if Stage A's measurement says it's necessary.

Note also: no wrapper function was needed here. Unlike
`kirim_line_report_bundle` (called once per serial, so it needed a
set-taking function behind the old name), these two are called **once per
request** — there is no top-level N+1 to factor out. Names and signatures are
unchanged, so no call site changes.

## What changed

**`rahbar_stock_snapshot`** — two pure restructurings:
1. `stock_on_hand_rows` was read **three times** (`scoped`, `old_kn_total`,
   `old_kn_by_type`, the last two deliberately unscoped per `0120`). Now read
   once into a materialized CTE. The unscoped reads stay unscoped by reading
   `all_rows`, preserving `0120`'s "old-KN total is scope-independent"
   behaviour exactly.
2. `kirim_line_moyka_asof(serial, current_date)` was called **once per
   kirim_line** with a moyka_sends row (~29 calls, each re-deriving the
   active wash cycle and re-scanning `moyka_sends` /
   `report_moyka_output_rows`). Replaced with one set-based pass: active
   cycle per serial via `DISTINCT ON`, then grouped sums joined back —
   including the "closed on or before today → 0" branch.

**`rahbar_dashboard_ledger`** — only the `lines` CTE. It carried **ten
correlated subqueries evaluated per kirim_line** (~330 subquery executions
per call): sent / rezka / dispatched / output, each "before `p_from`" and "as
of `p_to`", plus two `old_stock_closeouts` EXISTS checks. Each became a
pre-aggregated CTE joined once. Everything downstream of `lines` is
untouched.

### How the ledger body was produced (and why)

Retyping ~150 lines of ledger math invites transcription error, so the new
body is **spliced into the live `prosrc`** programmatically, with two guards
in the migration:

1. the regexp must actually match — a silent no-op replace is precisely the
   failure mode that produced a false "no improvement" result during the
   `0131` work (Postgres ARE uses `\y`, not `\b`, and a non-matching pattern
   fails quietly);
2. the spliced result must hash to `38e8c7f04c41dd11e64877d56b24e7b8` — the
   exact body verified byte-identical below. If the live function were not
   what was tested against, the migration aborts rather than installing
   something unverified.

## Verification — all levels passed BEFORE the swap

Built as throwaway functions inside `BEGIN … ROLLBACK`, compared against the
live functions:

| | combinations | result |
|---|---|---|
| `rahbar_stock_snapshot` | 3 scopes × 2 roles (rahbar + client) | **6/6 identical** |
| `rahbar_dashboard_ledger` | 4 periods × 3 scopes, rahbar | **12/12 identical** |
| `rahbar_dashboard_ledger` | client role, hammasi / full history | **identical** |

Periods: full history, current month, a window containing a wash-cycle close,
and an empty window.

- **Level 1 (per-field):** comparison is on the whole `jsonb` text, so every
  key is covered — stronger than a field list that could omit one.
- **Level 2 (period windows):** the four above; the snapshot has no period
  argument, so its scope axis is the equivalent.
- **Level 3 (both roles):** done — RLS changes row visibility, so this is not
  redundant with the rahbar run.
- **Level 4 (SPEC ledger identities):** satisfied **transitively**. The
  identities (`residualKg`, Ledger B's opening+sent−processed=closing, and
  input−calibre−kn−loss) are computed *inside* the returned document, so
  byte-identical output is strictly stronger than identity-equality. Stated
  as an argument rather than claimed as a separately-executed check.

**Post-swap re-verification against pre-swap baselines** — md5 of the live
functions captured immediately before the migration, re-checked immediately
after: all 5 match (`snap_yangi`, `snap_eski`, `snap_hammasi`,
`ledger_full_hammasi`, `ledger_month_yangi`).

## Rollback

`create or replace` restoring the previous bodies. The pre-swap
`rahbar_dashboard_ledger` source is recoverable from this repo's migration
history; `rahbar_stock_snapshot`'s previous body is the one in `0127`.

## Measurement

`pg_stat_statements` reset **2026-09-21 08:39:41 UTC**, immediately after the
swap. 4-hour measurement scheduled for 12:50 UTC, against the agreed Stage A
criteria: both RPCs' `max_exec_time` < 5s under load, and zero timeouts on
either.

**Performance will be judged from `pg_stat_statements` only, not spot
probes** — single-shot timing during business hours was observed varying
**5–75x** on identical queries (`0213`), which makes it useless for
before/after comparison.

Also in flight and measured by the same window: the `statement_timeout`
step-down 20s → 12s (`0136`, applied ~07:45 UTC the same morning). If
timeouts rise under the 12s ceiling, the agreed protocol is to back off to
15s.

## Not done here, deliberately

- **Stage B** (`stock_on_hand_rows` itself) — pending Stage A's numbers.
- **Dead code**: `client_panel_summary`, `client_serial_ledger` and
  `client_old_stock_breakdown` have no frontend caller at all. Flagged only;
  a separate hygiene migration after Stage A stabilises, not bundled into
  performance work.
