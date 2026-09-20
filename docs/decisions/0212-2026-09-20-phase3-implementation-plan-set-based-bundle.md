# IMPLEMENTATION PLAN (awaiting approval, no code written): Phase 3 set-based rewrite

Option 1 approved (`0210`). This is the plan: what gets rewritten, how it is
proved byte-identical, how it rolls out, and what to expect afterwards.

## Early validation already done

Before planning, the **hardest single field** was prototyped and diffed
against the live function. `loss_range` is the one that depends on cycle
windows and calls `client_calibre_split` per closed cycle:

```
mismatches: 0      non-null (current): 18      non-null (set-based): 18
```

Compared with `IS DISTINCT FROM` across every serial, so NULL-vs-0 was in
scope — `loss_range` is legitimately NULL when no cycle closed in the window,
and collapsing that to 0 would be a real regression. It did not.

Also confirmed: `client_calibre_split(serial, from, to)` is nothing but a
filtered `sum(weight_kg) FILTER (WHERE [not] is_numberless)` over
`finished_pallets`. It does not need to stay a function call — its logic
inlines into the set-based pass, removing one nested per-cycle call.

## 1. What gets rewritten

**New:** `kirim_line_report_bundle_set(p_serials text[], p_from date, p_to date)`
→ `RETURNS TABLE(serial text, <the same 20 columns>)`, one row per input
serial, computed with `GROUP BY serial` over the event tables.

Per-field construction (all 20 accounted for):

| field | set-based source |
|---|---|
| `state_qabul_qilingan` | `kirim_line_effective_qty` per serial (already cheap; batched via join) |
| `state_moykaga_yuborilgan` | `sum(qty_kg) GROUP BY serial` on `moyka_sends` |
| `state_xom_jonatilgan` | `sum(net_kg) GROUP BY serial` on `raw_dispatch_lines` |
| `state_moykadan_chiqgan` | `sum(weight_kg) GROUP BY serial` on the filtered `finished_pallets` set |
| `state_omborda_qoldi` | `greatest(0, eq − sent − rezka − raw_disp)` from the four above |
| `state_olib_ketilgan` | consumption ⋈ lines ⋈ requests, `chiqim_departed_at(request) IS NOT NULL`, grouped — **12 requests total**, so the departed-at call is evaluated per request, not per serial |
| `moyka_range_to_moyka_kg` | same `moyka_sends` scan, `sent_date BETWEEN p_from AND p_to` |
| `moyka_range_from_moyka_kg` | `report_moyka_output_rows`, `date_basis` in range |
| `calibre_output_k1..k8`, `_kn` | one `GROUP BY serial, code` + `FILTER` pivot (measured: 280ms for all serials incl. this pivot) |
| `state_moykada` | per-cycle: open cycles only, `LATERAL` over **cycles** (31 rows) not serials |
| `moyka_asof` | active cycle at `p_to` via `DISTINCT ON (serial) … ORDER BY opened_at DESC`, then windowed sums |
| `loss_range` | closed-in-range cycles ⋈ sends ⋈ pallets, grouped — **prototyped, 0 mismatches** |

**Rewritten to use it:**
- `report_query_page(text[], …)` — replaces `cross join lateral kirim_line_report_bundle(ds.serial, …)` with a single call passing the page's distinct serials as an array, joined back by `serial`. The `0135` dedup CTE structure stays; only the bundle source changes.
- `report_totals(text[], …)` — same substitution against its `distinct_serials` CTE.

**Kept, unchanged in behaviour:**
- `kirim_line_report_bundle(p_serial, p_from, p_to)` becomes a thin wrapper:
  `SELECT … FROM kirim_line_report_bundle_set(ARRAY[p_serial], p_from, p_to)`.
  This is the point of the design — the other ~25 objects that reference it
  (and `get_serial_passport`, `client_*` ledgers, Hisobot helpers) keep
  working untouched, against one code path that gets verified once.

**Explicitly NOT in scope:** `rahbar_stock_snapshot` /
`stock_on_hand_rows`. They are pure current-state and deserve the same
treatment, but bundling them doubles the blast radius of a ledger-math
change. Separate follow-up, measured on its own.

## 2. Byte-identical verification

Same discipline as `0135`, tightened because this changes math rather than
call count. The gate is **all four levels passing**, not just the last.

**Level 1 — per-serial, per-field.** For every serial in `kirim_lines`, all
20 fields, old vs new, compared with `IS DISTINCT FROM`. Aggregate agreement
is not accepted as evidence: two serials wrong in opposite directions cancel
in a sum. This is the level that already ran clean for `loss_range`.

**Level 2 — across period windows that exercise the cycle logic**, not one
convenient range:
(a) full history, (b) current month, (c) a window containing a cycle *close*,
(d) a window *between* two cycles of the same serial, (e) a window ending
mid-cycle (exercises `moyka_asof`), (f) an empty window, (g) a window
covering the one `cycle_no = 2` serial. Fixture reality: 31 cycles, 21
closed, 8 open, max `cycle_no` 2.

**Level 3 — whole-RPC md5**, both roles. `report_query_page` and
`report_totals` output hashed row-by-row in output order, across the `0135`
combinations (no filters / `['kirim']` / chiqim family / pagination offset),
as **rahbar** (`read_all`) and as **client** (`client_read_own_*`) — RLS
changes row visibility and therefore the sums. Baselines captured from the
live functions immediately before the swap, re-checked immediately after.

**Level 4 — SPEC identity invariants** must still hold:
`openingKg + sentToMoykaKg − processedKg = closingKg` (Ledger B) and
`input − calibre − kn − loss = 0`, the same gates used in v1.52.

All four are pure `SELECT` comparisons — **no fixtures created, nothing
voided**, so CLAUDE.md's `TEST-`-prefix rule is satisfied by not writing at
all.

## 3. Rollout

**Swap in place. No shadow migration.** Justification:

- `CREATE OR REPLACE FUNCTION` on a `LANGUAGE sql STABLE` function is
  transactional DDL — it either takes or it doesn't, with no intermediate
  state.
- Verification happens **before** the swap, not after: levels 1–2 run
  against `kirim_line_report_bundle_set` while the old function is still the
  one serving traffic, because the new function can be created under its own
  name and compared side-by-side in a plain transaction. Only once it agrees
  on every serial × every window does `report_query_page`/`report_totals`
  get repointed.
- Rollback is a single `CREATE OR REPLACE` restoring the previous bodies,
  which are preserved verbatim in the migration file's header (the same
  pattern `0119`'s emergency restore used).

Sequence, one migration:
1. Create `kirim_line_report_bundle_set` (new name — nothing calls it yet).
2. Run levels 1–2 in a transaction. **Stop here if anything mismatches.**
3. Capture level-3 md5 baselines from the live RPCs.
4. `CREATE OR REPLACE` `report_query_page`, `report_totals`, and
   `kirim_line_report_bundle` (as the wrapper) in one migration.
5. Re-run level 3 against the deployed functions; run level 4.

⚠️ **Lock note, learned the hard way:** `ALTER`/`REPLACE` on objects under
live read traffic hit two real `40P01` deadlocks during the `0131` work.
Apply with a short `lock_timeout` and retry rather than letting it queue,
and prefer a low-traffic moment (Tashkent is UTC+5; the logs show business
traffic roughly 08:00–13:00 UTC).

## 4. Expected result

Grounded in the probes, not optimism:

| | today | expected |
|---|---|---|
| `report_query_page` typical | ~1,850ms | **~400–600ms** |
| `report_query_page` max under load | **14,329ms** | **< 3,000ms** |
| `report_totals` typical | ~770ms | **~300–500ms** |
| 24h PostgREST statement timeouts | 188 (baseline) | **0** |

Reasoning: the measured set-based components are 148ms (lifetime) + 280ms
(period incl. pivot) + 21ms (cycle windowing) ≈ 450ms for **all** serials,
versus today's per-serial repetition. The max-under-load figure should
compress hardest, because the 14.3s peak came from N× re-execution colliding
with concurrency — removing the N is what removes the tail.

**Honest uncertainty:** these are single-shot measurements on a quiet
database. Concurrency is what produced the 8x inflation (1.85s isolated →
14.3s under load) and this plan does not change concurrency, only the work
per request. If the tail does not collapse proportionally, the next suspect
is `rahbar_stock_snapshot`/`stock_on_hand_rows` (deliberately out of scope
above), not this rewrite.

## 4b. PRE-SWAP VERIFICATION ALREADY RUN (2026-09-20, in rolled-back transactions)

Built `kirim_line_report_bundle_set` as a throwaway (`zz_bundle_set`) inside
`BEGIN … ROLLBACK`, so nothing was applied to the schema, and ran levels 1
and 2 against the live function.

**Level 1 — per-serial, per-field, full history window: PASS.**
All 20 fields × 33 serials, compared with `IS DISTINCT FROM`:

```
serials 33 | d_qabul 0 | d_omborda 0 | d_sent 0 | d_moykada 0 | d_out 0
| d_xom 0 | d_departed 0 | d_asof 0 | d_rto 0 | d_rfrom 0
| d_calibres 0 | d_loss 0
```

**Level 2 — seven period windows: PASS.** 0 mismatched serials in every
window (231 row comparisons, 20 fields each). Windows built from the real
cycle dates of the multi-cycle serials (`290726-068/069/072`: cycle 1 opened
2026-08-14 closed 08-29, cycle 2 opened 09-15 closed 09-16):

| window | mismatches | `loss_range` non-null |
|---|---|---|
| a full history | 0 | 18 |
| b current month | 0 | 13 |
| c contains close 08-29 | 0 | 11 |
| d between cycles (08-30→09-14) | 0 | 8 |
| e ends mid-cycle (09-15) | 0 | 0 |
| f empty window (2020) | 0 | 0 |
| g cycle-2 close (09-16) | 0 | 3 |

The `loss_range` non-null spread matters: it proves the windows actually
exercise different cycle states rather than all being vacuously NULL.
Window (g) isolates exactly the 3 multi-cycle serials, and (e)/(f)
correctly produce none.

Levels 3 and 4 still to run — they need the rewritten
`report_query_page`/`report_totals`, so they happen at swap time per §3.

### ⚠️ Correction to §4's estimate — I was wrong

The draft set-based function measures **780ms** for all 33 serials, not the
**400–600ms** §4 predicted. Reporting the miss rather than quietly restating
the target.

Component probes locate the gap, and it is **not** where I first guessed:

| component, all serials | elapsed |
|---|---|
| `kirim_line_effective_qty` ×33 | **6.7ms** (my first hypothesis — wrong) |
| `report_moyka_output_rows` scan | 62ms |
| `departed` (incl. `chiqim_departed_at` per request) | 40ms |
| `finished_pallets` filtered scan | 28ms |
| **sum of identified components** | **~137ms** |

So ~640ms is unaccounted for by the scans. The remaining suspect, from the
draft's own shape: `moykada`, `asof` and `loss` still use **correlated
subqueries** against the materialized CTEs — roughly 62 subquery executions
(33 serials + 8 open cycles + 21 closed cycles), each a seq scan over a
tuplestore with no index, ≈124 CTE scans in total. That is the same
per-row-re-execution pattern this whole phase exists to remove, just at a
smaller scale.

**Implementation refinement (before swap):** convert those three CTEs from
correlated subqueries to plain joins + `GROUP BY serial`. Revised expectation
**~400–600ms stands only if that refinement lands**; without it the honest
number is ~780ms, still a 2.4x improvement on today's 1,850ms but not the
4x §4 claimed. The `< 3,000ms` max-under-load target is unchanged and remains
the real acceptance criterion.

## 5. Verification environment gap

Levels 1–4 are all SQL and run fine from here. What still cannot be checked
from this sandbox is the **UI** reading the rewritten RPCs — the proxy
blocks browser→Supabase. The TEST CLIENT account being added should let
`client-portal-smoke.spec.ts` cover the client side; Hisobot's own spec
additionally needs `TEST_MENEJER_*`, which `.env.test` also lacks.
