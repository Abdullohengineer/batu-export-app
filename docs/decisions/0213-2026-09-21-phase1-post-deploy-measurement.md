# Phase 1 post-deploy measurement — Hisobot fixed, dashboards worse

Window: `pg_stat_statements` reset **2026-09-20 07:06:05 UTC** (right after
PR #164 merged at 07:03), measured **2026-09-21 07:43 UTC**. Actual window
**24h 37m**, not the planned 4h — the scheduled check-in fired at 11:15 on
the 20th but the session was idle until the 21st.

⚠️ **Only ~3 hours of that window carried real business load.** 2026-09-20
was a Sunday. The first genuine business traffic post-deploy is Monday
2026-09-21, 05:00–07:00 UTC (10:00–12:00 Tashkent). Every timeout in the
window falls in those three hours. Read the numbers with that in mind.

## Result: split verdict

| RPC | metric | before (17-min sample) | after (24h) | verdict |
|---|---|---|---|---|
| `report_query_page` | mean | 2,298ms | **897ms** | ✅ 2.6x better |
| | max | 14,329ms | **4,873ms** | ✅ 2.9x better |
| `report_totals` | mean | 640ms | 867ms | ~ flat |
| | max | 6,567ms | 8,383ms | ~ flat |
| `rahbar_dashboard_ledger` | mean | 1,728ms | **4,656ms** | ❌ 2.7x **worse** |
| | max | 2,961ms | **19,236ms** | ❌ 6.5x **worse** |
| `rahbar_stock_snapshot` | mean | 2,075ms | **4,255ms** | ❌ 2.1x **worse** |
| | max | 3,456ms | **17,213ms** | ❌ 5.0x **worse** |

## Timeouts: 106, and 100% of them are the two dashboard RPCs

Baseline was 188/24h. Since the merge: **106**, last one 07:35:14 today.
Not zero. But the composition changed completely:

| context | count |
|---|---|
| `rahbar_dashboard_ledger` | 21 + 3 during startup |
| `rahbar_stock_snapshot` | 19 + 5 during startup |
| (empty ctx — outer BIND of the same two) | 58 |
| `report_query_page` / `report_totals` | **0** |

**Hisobot has stopped timing out entirely.** The `0135` dedup plus Phase 1
caching did what they were meant to do. Every remaining timeout is a
dashboard call.

Note the max values: 19,236ms and 17,213ms, against the 20s ceiling set in
`0134`. These are running right up to the limit.

## It is contention, not a regression

Measured both RPCs in isolation just now, on a quiet database:

| | isolated, now |
|---|---|
| `rahbar_stock_snapshot('yangi')` | **860ms** |
| `rahbar_dashboard_ledger(month, 'yangi')` | **346ms** |

Unchanged from the pre-Phase-1 isolated figures. The functions did not get
slower — they inflate **5–13x under concurrent Monday-morning load**, which
is precisely the pattern `report_query_page` showed before it was fixed
(1.85s isolated → 14.3s under load).

⚠️ **Measurement trap worth recording:** the first attempt at this probe
returned 7ms and 10ms. That was an artifact —
`SELECT … FROM (SELECT rahbar_stock_snapshot('yangi')) q` leaves the result
unreferenced, and because the function is `STABLE` the planner elides the
call entirely. Re-run consuming the value (`length(…::text)`) to get a real
number. Any future timing probe of a `STABLE` function must consume its
result.

## Two things that did resolve

- **`declared_tara_kg` is gone.** 40 occurrences in the 24h before the
  merge; **zero** since. The stale-bundle error cleared itself when the new
  deploy shipped — which lowers the urgency of Phase 2.
- **Dashboard call volume dropped sharply**: 51 `rahbar_dashboard_ledger`
  calls in 24h, versus ~21/hour in the pre-Phase-1 sample (~500/24h
  equivalent). Consistent with React Query caching working as intended.

Note on Phase 1A: `pg_stat_statements` normalises parameters, so the actual
date range sent cannot be read from it directly. The volume drop is
consistent with Phase 1B; the 1A default change could not be confirmed or
refuted from this data.

## What this changes

1. **`rahbar_stock_snapshot` / `stock_on_hand_rows` must come INTO Phase 3
   scope, and go first.** `0212` §1 explicitly excluded them to limit blast
   radius. That call now looks wrong: they are the entire remaining problem,
   and Hisobot — the part that *was* in scope — is fixed.
2. **The 20s `statement_timeout` (`0134`) may be an own-goal.** Raising it
   from 8s means each pathological run now occupies a connection up to 20s
   instead of 8s. Under a pile-up that is 2.5x more connection-seconds of
   contention, which plausibly contributes to the very inflation measured
   above. Recommend reverting to ~8–10s once the dashboards are fixed, and
   considering it sooner.
3. **Phase 2 (stale PWA cache) drops in priority** — its headline symptom
   resolved on its own.

## Honest caveat on the "before" numbers

The 17-minute pre-Phase-1 baseline was flagged at the time as too short.
It may simply have sampled a quieter moment: the dashboards' true
under-load behaviour may always have been this bad, rather than having
degraded. Either reading leads to the same action — the dashboards are now
the top offender and need the set-based treatment.
