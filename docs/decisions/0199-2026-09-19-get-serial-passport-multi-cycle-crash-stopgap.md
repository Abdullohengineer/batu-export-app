# `get_serial_passport` multi-cycle crash — stopgap fix

## What this is

`get_serial_passport('290726-068'/'069'/'072')` started raising a hard SQL
error immediately after `0198`'s residual-reprocess execution gave those
three serials a real second `wash_cycles` row — investigated read-only
first (see the investigation report earlier this session), then patched
with the minimal fix Abdulloh chose (Option 1: latest-cycle-only), applied
same session after confirmation.

## The bug

```
ERROR: 21000: more than one row returned by a subquery used as an expression
CONTEXT: SQL function "get_serial_passport" statement 1
```

Reproduced for all three serials before the fix. Root cause: the `cycles`
CTE's `'lab'` field is a scalar subquery reading `cycle_lab` with **no
correlation back to the specific outer `wc` row** it's nested under
(`where cl.verdict is not null`, nothing tying it to `wc.id`). `cycle_lab`
itself is correctly per-cycle (`from wc left join lateral (... where
wash_cycle_id = wc.id ...)`), so once `wc` (`select * from wash_cycles
where serial = p_serial`) had 2 rows, `cycle_lab` had 2 rows too — both
with a real, non-null `verdict = 'o_tdi'` (cycle 1 tested 2026-08-25,
cycle 2 tested 2026-09-16, both by Murodjon Obidov). The uncorrelated
subquery returned 2 rows into a context expecting 0-or-1, hitting Postgres'
cardinality check. Never revisited when Path E (`0124`/`0196`) reopened
multi-cycle `wash_cycles` — deliberately deferred to prompt (b), per
`0196`'s own "Downstream consumers still on lifetime sums" flag, but that
flag assumed *risk*, not a confirmed crash — this is the first real serial
to actually exercise it.

## The fix (Option 1 of two proposed; the full prompt (b) rewrite was the other)

`supabase/migrations/0128_get_serial_passport_latest_cycle_stopgap.sql` —
narrows the `wc` CTE to the latest cycle only:
```sql
wc as (
  select * from wash_cycles where serial = p_serial order by cycle_no desc limit 1
),
```
Same "latest cycle" convention `0124`/`0127` already use elsewhere. `wc` is
referenced nowhere else in this function besides `cycles`/`cycle_lab`, so
this is fully self-contained — zero blast radius on `order`/`gate`/
`intake`/`dispatches`/`joriyHolat`/etc.

Verified via a disposable shadow-function test (created and dropped)
**before** applying this migration, then re-verified live against the real
function after applying:

| Serial | closedAt | lossKg | sentKg | lab |
|---|---|---|---|---|
| 068 | 2026-09-16 | 52 | 2412 | o'tdi, cycle 2's own reading (Murodjon Obidov) |
| 069 | 2026-09-16 | 54 | 2284 | o'tdi, cycle 2's own reading |
| 072 | 2026-09-16 | 59 | 2239 | o'tdi, cycle 2's own reading |

`lossKg` is not fabricated data despite being whole-serial — it exactly
matches `client_serial_loss_kg` (already-verified correct lifetime
cumulative loss, `0198`), because `sends_total`/`finished_returned_total`
were always whole-serial sums by construction (correct when there was only
ever 1 cycle); the fix just makes the single remaining card an honest
"this serial's lifetime state" summary rather than per-cycle breakdown.
**Correct-but-incomplete, not correct-but-wrong.**

Regression-checked against a known single-cycle serial (`110826-001`):
`cycle_count = 1`, `lossKg = 140`, `closedAt` unchanged — byte-identical to
before this fix, confirming `order by ... limit 1` is a no-op for every
serial that still has exactly one cycle (every serial except these three).

## What's still incomplete (deliberately, out of scope tonight)

- `cycleNo` stays hardcoded to `1` — harmless, since only one card renders
  and neither `PassportCycle` (TS interface, `src/lib/serialPassport.ts`)
  nor `SerialPassportModal.tsx` (`cycles.map((cycle, i) => ...)`, keyed by
  array index) read `cycleNo` at all.
- `pallets` inside the single remaining cycle card still shows **every**
  pallet across both cycles (the `pallets` CTE was always whole-serial,
  `select * from report_chiqim_rows rcr where rcr.serial = p_serial`,
  never cycle-scoped — pre-existing behavior, not a new regression).
- The two-cycle breakdown itself (cycle 1's own 50kg loss vs. cycle 2's own
  2kg, for `290726-068`) is not visible on the passport — it collapses to
  one 52kg lifetime figure. Visible elsewhere (Hisobot, `client_serial_
  ledger`, `get_client_report`, all correct per `0197`/`0198`), just not
  here.

## Real fix remains prompt (b)

Real `cycleNo` (from `wc.cycle_no`, not hardcoded), per-cycle-windowed
`sentKg`/`inMoykaKg`/`lossKg` (reusing the `[opened_at, next_opened_at)`
pattern `0127` already established for `kirim_line_moyka_asof`/
`kirim_line_loss_asof`), and `pallets` filtered to each cycle's own window
instead of duplicated whole-serial. Frontend needs no changes for this —
confirmed during investigation that `SerialPassportModal.tsx` already
renders `cycles` generically as a real array.

**Now confirmed live-blocking for two real functions** (`yield_rows` per
`0198`, `get_serial_passport` per this entry) once a serial has a genuine
second cycle — prompt (b) should be picked up soon rather than let a third
accumulate.

## Out of scope, deliberately not touched

- The full multi-cycle `cycles` array rewrite — prompt (b).
- `yield_rows`' own duplication bug (`0198`) — unrelated function, separate
  fix, still not addressed.
- UI — `SerialPassportModal.tsx` untouched; no frontend change needed for
  this fix to take effect.

## Related

- `docs/decisions/0196` §3.5 — the original flag naming `get_serial_
  passport`'s `cycles` array as deferred to prompt (b), written before any
  real serial had exercised the risk.
- `docs/decisions/0197` — the `[opened_at, next_opened_at)` cycle-window
  pattern the eventual prompt (b) fix should reuse.
- `docs/decisions/0198` — the residual-reprocess execution whose real
  multi-cycle data exposed this crash (and the separate `yield_rows`
  duplication bug) for the first time.
