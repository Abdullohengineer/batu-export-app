## 2026-08-31 — Rahbar dashboard booked an open wash cycle's remainder as loss (0108)

Rahbar's dashboard reported **1,447 kg** of washing loss on the default view (boshidan, scope
"yangi"). Every other surface said **1,432 kg** — `yield_rows` returns exactly that across 10
serials. The user spotted it and named the cause correctly before any investigation:
"did it take most recent serial's remainders in moyka as loss? which it shouldn't as it's now
is in moyka stage as available stock."

**The whole gap is one serial.** `110826-002`: 7,345 kg sent to Moyka, 7,330 kg returned as
pallets, wash cycle `closed_at IS NULL`. The unreturned 15 kg was booked as loss. The other
ten serials sum to 1,432 on the nose.

`processed_lines` credits the full amount ever sent to Moyka while `processed_output` counts
only what has come back. For a serial mid-wash that difference is stock, not loss, and
nothing subtracted it. `yield_rows` never had the bug because its `finished_serials` CTE
gates on `closed_at is not null`; `rahbar_dashboard_ledger` had no such gate.

**It was also a double count.** `moyka_in_process` (feeding `moykadaSnapshot.closingKg`,
24,030 kg) already counts an open cycle's unreturned balance as stock, by design. The same
15 kg was therefore reported twice — once as loss, once as available stock.

**Attribution: this is 0106's, and 0106 is mine.** Before it, `processed_lines` qualified on
`closed_at` falling inside the period, which implicitly excluded open cycles. Moving to
Basis B fixed a real and larger problem — that same serial's 7,345/7,330 was invisible to
Ledger B entirely, which 0106's own header names — but dropped the only thing stopping an
open cycle's remainder being read as loss. Basis B is correct and stands; 0108 restores the
protection without giving it up.

**This also settles the residual I got wrong.** When 0106 went in, `moykadaSnapshot.residualKg`
moved 7,330 → −15 and I predicted it would reach 0. It did not, and I reported the miss
without an explanation. The −15 was this double count. It is now 0.

### Measured, live, boshidan (2026-07-15 → 2026-08-31), scope "yangi"

| | before | after |
|---|---:|---:|
| `moyka.processedKg` | 41,637 | 41,622 |
| `moyka.lossKg` | 1,447 | **1,432** (= `yield_rows`, exactly) |
| `moyka.lossPct` | 3.5% | 3.4% |
| `moykadaSnapshot.residualKg` | −15 | **0** |

`calibreKg` (33,820) and `konditirskiyKg` (6,370) are untouched — the fix is entirely on the
input side of the subtraction.

### The historical half of the guard is a no-op today — said out loud

`(closed_at at time zone 'utc')::date > p_to` is there so a serial closed now but open at a
past `p_to` is handled when that period is viewed. Measured across p_to = 08-11, 08-15,
08-18, 08-20, 08-24, 08-29, 08-31: **the numbers move only at 08-29 and 08-31.** The guard is
deliberate and load-bearing for future periods, but unexercised by today's rows. Recorded
explicitly per this file's own rule about exclusions that only appear to work because the
data does not currently overlap — it is not an accident being passed off as a filter.

### Pre-existing anomalies found while measuring — flagged, not fixed

- **p_to = 2026-08-18 reports negative loss, −1,428 kg.** Identical before and after 0108, so
  0108 neither causes nor fixes it. This is the mixed-time-basis defect logged on 2026-08-30:
  `sent_capped_kg` counts all-time moyka sends while the output it is compared against is
  period-bounded. Recording the negative-loss case as new evidence of that defect's reach —
  the original entry had nothing this stark.
- **p_to = 2026-08-24 reports `moykadaSnapshot.residualKg` = 1,040.** Also identical before
  and after.
- **`raw.residualKg` reads −1,040 on the current period.** `raw_identity_residual` does not
  reference `processed_lines`, so it is untouched by 0108.

`get_client_report` was checked, not assumed: its `loss_totals` CTE gates on
`closed_at is not null`, so it does **not** have this defect and needed no change (it remains
on the do-not-change list regardless).

### Verification

Disposable local Postgres 16 sandbox, clean replay `0001`→`0108` with only the two known
data-seed failures (`0048`, `0100`, which need real seeded rows and auth users). Applied to
live as an in-place text patch on the function definition, with occurrence assertions and an
already-applied guard, rather than re-pasting the whole 340-line body.

**Live and repo proven equal on logic:** `md5(pg_get_functiondef(...))` differs between live
and sandbox, but that is pre-existing — 0106 was itself applied to live by in-place patch, so
live carries its inline comments in a slightly different form. Comparing the bodies with
comments stripped and whitespace collapsed gives `892f10d781d8522a16e91f832d7f4a64`, 14,076
chars, **identical on both sides**. Worth knowing for the next person: raw `pg_get_functiondef`
md5s are not expected to match between live and a clean replay for this function.
