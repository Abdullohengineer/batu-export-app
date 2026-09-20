# PROPOSAL (awaiting approval, no code written): Phase 3 — how to kill the per-serial recomputation

Design-only. Nothing here is implemented. It answers the four questions
asked — schema, triggers, write amplification, byte-identical verification —
but it also reports a measurement that changes the recommendation, so the
approved option (trigger-maintained summary table) is presented alongside a
cheaper alternative rather than assumed.

## The measurement that changes the picture

The premise for a summary table was "the same join tree runs in 25–30
objects and costs seconds." That's true of how it runs **today** (one
parameterised call per serial, via `LATERAL`). It is **not** true of the
work itself. Computing the same values for **every serial at once**, set-based:

| computation, all 33 serials in one pass | elapsed |
|---|---|
| Lifetime/current half (effective qty, sent, rezka, raw dispatched, moyka out) | **148ms** |
| Period half incl. the full K1–K8/KN calibre pivot, full-year window | **280ms** |
| Cycle windowing (31 cycles, 21 closed in range, max `cycle_no` = 2) | **21ms** |

Versus today: `report_query_page` **1,850ms**, `report_totals` **770ms** —
each doing the *same* work one serial at a time.

So the entire bundle, computed set-based for every serial, costs roughly
what **one** page of the current per-serial approach costs. The expense was
never the data (33 kirim_lines, 265 finished_pallets, 31 wash_cycles, all
in cache at a 100% hit ratio) — it was doing it N times with a ~1,458-node
plan each time.

## The structural fact that decides it

`kirim_line_report_bundle` returns 20 values per serial. Split by whether a
stored table could hold them:

**Lifetime / current-state — 7 values.** A summary table *could* store these:
`state_qabul_qilingan`, `state_omborda_qoldi`, `state_moykaga_yuborilgan`,
`state_moykada`, `state_moykadan_chiqgan`, `state_xom_jonatilgan`,
`state_olib_ketilgan`.

**Period-scoped — 13 values.** A summary table **cannot** store these,
because the period is a runtime argument and the range is arbitrary:
`moyka_asof` (as of `p_to`), `moyka_range_to_moyka_kg`,
`moyka_range_from_moyka_kg`, `calibre_output_k1..k8` + `_kn` (9),
`loss_range` (cycles closed within the window).

**So a trigger-maintained summary table addresses 7 of 20 values.**
`report_query_page` and `report_totals` — 35% of all database time — would
still do per-serial period work for the other 13. The table would
materially help only `rahbar_stock_snapshot` (18.4%), which is pure
current-state.

## Option 1 — set-based rewrite (recommended)

Replace the per-serial `LATERAL` call with one set-based computation over
the serials already on the page.

- New `kirim_line_report_bundle_set(p_serials text[], p_from date, p_to date)`
  returning one row per serial, built from `GROUP BY serial` aggregates
  (exactly the shape the probes above measured).
- `report_query_page` / `report_totals` join it once instead of calling
  per serial. `kirim_line_report_bundle` (single-serial) stays as-is for any
  other caller, delegating to the set version with a one-element array, so
  nothing else in the 25–30 dependent objects has to change at once.
- The cycle-aware three (`state_moykada`, `moyka_asof`, `loss_range`) keep
  a `LATERAL` over **cycles** rather than serials — 31 rows total, 21
  closed-in-range, measured at 21ms, so the N+1 that remains is over a set
  an order of magnitude smaller and bounded by wash activity, not by report
  size.

**Why this over the table:** no new state, so no possibility of drift in a
stock ledger; no triggers; no write amplification; no staleness window; and
it fixes the period-scoped 13 that a table structurally cannot. It is a pure
query restructure of the kind already proven safe in `0135` (the dedup),
which shipped byte-identical across four filter/role combinations.

**Risk:** it is a genuine rewrite of ledger math (`moykada_per_cycle`,
`moyka_asof_calc`, `loss_range_calc` with its nested `client_calibre_split`
call per closed cycle). That risk is handled by the verification plan below,
not by hoping.

## Option 2 — trigger-maintained summary table (as approved)

Presented in full so it can be compared, not dismissed.

**Schema**

```
serial_state_summary
  serial              text primary key references kirim_lines(serial)
  effective_qty_kg    numeric not null default 0   -- state_qabul_qilingan
  sent_to_moyka_kg    numeric not null default 0   -- lifetime
  rezka_sent_kg       numeric not null default 0
  raw_dispatched_kg   numeric not null default 0
  moyka_out_kg        numeric not null default 0   -- lifetime
  moykada_kg          numeric not null default 0   -- current, cycle-aware
  departed_kg         numeric not null default 0
  omborda_qoldi_kg    numeric generated always as
                        (greatest(0, effective_qty_kg - sent_to_moyka_kg
                         - rezka_sent_kg - raw_dispatched_kg)) stored
  updated_at          timestamptz not null default now()
```

RLS: same `read_all` + `client_read_own_*` shape as every other table
(CLAUDE.md), with the client policy joining through `kirim_lines` →
`kirim_orders.owner_id` exactly as `client_read_own_kirim_lines` does.

**Triggers** — a `security definer` recompute-one-serial function, fired
`AFTER INSERT OR UPDATE OR DELETE` on **13 tables**, each needing its own
"which serial(s) did this touch" mapping:

| table | serial mapping | why it affects the summary |
|---|---|---|
| `kirim_lines` | `NEW.serial` | declared qty / row existence |
| `storage_intake` | `NEW.serial` | effective qty (actual weight) |
| `gate_weighings` | via `order_id` → all lines on the order | effective qty authority |
| `moyka_sends` | `NEW.serial` | sent / moykada |
| `rezka_sends` | `NEW.serial` | rezka sent |
| `raw_dispatch_lines` | `NEW.serial` | raw dispatched |
| `finished_pallets` | `NEW.serial` | moyka out / moykada |
| `serial_mint_sources` | `source_barcode2` → `finished_pallets.serial` | excludes re-minted pallets |
| `chiqim_pallet_consumption` | `barcode2` → `finished_pallets.serial` | departed |
| `chiqim_lines` | via `request_id` → consumption → pallets | departed (indirect) |
| `chiqim_requests` | via lines → consumption → pallets | departed depends on `chiqim_departed_at(request)` |
| `wash_cycles` | `NEW.serial` | moykada is cycle-windowed |
| `old_stock_closeouts` | `owner_id` + `type_id` → all matching serials | zeroes raw remainder |

**Write amplification.** Low in volume: at the measured 1.2 writes/hour,
each business write recomputes 1 serial in the common case, up to ~10 when a
truck-level row changes (a `chiqim_requests` status flip fans out to every
pallet on that truck). So ≈1.2–12 summary-row updates/hour — negligible,
and the recompute itself is a handful of indexed lookups on ≤265-row tables.

**Volume is not the objection.** The objections are:

1. It serves 7 of 20 values (above), so the hot path keeps its per-serial
   work anyway.
2. **13 trigger paths, three of them indirect** (`serial_mint_sources`,
   `chiqim_pallet_consumption`, `chiqim_requests`). A missed path doesn't
   error — it silently drifts, in the table the dashboards and client-facing
   reports read. This codebase's own history (`0202`, `0206`) is a sequence
   of silent-drift bugs found only after they were live.
3. `chiqim_requests`' contribution goes through `chiqim_departed_at(id)`,
   whose result changes when a *gate weighing* completes — so the dependency
   graph is wider than the table list suggests.
4. It adds permanently-maintained state to a system whose stated rule is
   "Derive, don't store: running balances are computed by summing an
   append-only event log, not kept as a stored/synced column" (CLAUDE.md).
   This would be the first deliberate exception to that rule.

**When Option 2 becomes right:** if row counts grow by ~100x (say
`finished_pallets` into the tens of thousands), the set-based pass stops
being ~400ms and precomputation starts paying for itself. At today's volume
it does not.

## Recommendation

**Option 1 (set-based rewrite), plus one narrowly-scoped piece of Option 2
only if `rahbar_stock_snapshot` stays slow after it.** `stock_on_hand_rows`
is pure current-state, so it is the one place a stored table is a clean fit
— but the same set-based treatment should be tried there first, since the
probes suggest its cost is also structural (per-row `LATERAL`s plus
`chiqim_departed_at` per row) rather than volume.

## Byte-identical verification plan (applies to either option)

The method already proven in `0135`, tightened, because this changes ledger
math rather than just invocation count:

1. **Per-serial, per-field diff — not aggregate totals.** Aggregates can
   agree while individual serials are wrong in offsetting directions. For
   every serial in `kirim_lines`, compare all 20 bundle fields old-vs-new
   with `IS DISTINCT FROM` (so NULL-vs-0 is caught — `loss_range` is
   legitimately NULL when no cycle closed in range, and turning that into 0
   would be a real regression).
2. **Across period windows that exercise the cycle logic**, not just one
   range: (a) full history, (b) current month, (c) a window containing a
   cycle *close*, (d) a window *between* two cycles of the same serial,
   (e) a window ending mid-cycle (exercises `moyka_asof`), (f) an empty
   window. The 8 open + 21 closed cycles and the one `cycle_no = 2` serial
   are the fixtures that matter.
3. **Both roles** (rahbar via `read_all`, client via `client_read_own_*`),
   since RLS changes which rows are visible and therefore the sums.
4. **Whole-RPC md5 comparison** on `report_query_page`/`report_totals`
   output across the filter/pagination combinations used in `0135`,
   captured from the live functions immediately before the swap and
   re-checked immediately after.
5. **SPEC identity checks** must still hold: Ledger B's
   `openingKg + sentToMoykaKg − processedKg = closingKg`, and
   `input − calibre − kn − loss = 0` (SPEC §, already used as a regression
   gate in v1.52).
6. Run it as a `TEST-`-prefixed-free, read-only comparison — this is pure
   SELECT verification, so no fixtures are created and nothing is voided.

## Open questions for you

1. Option 1 or Option 2 (or Option 1 now, Option 2 later if volume grows)?
2. If Option 1: keep the single-serial `kirim_line_report_bundle` as a thin
   wrapper (safer for the other ~25 dependent objects, one code path to
   verify) — agreed?
3. `loss_range`'s NULL-vs-0 distinction is real and load-bearing. Confirm it
   must be preserved exactly (I intend to preserve it).
