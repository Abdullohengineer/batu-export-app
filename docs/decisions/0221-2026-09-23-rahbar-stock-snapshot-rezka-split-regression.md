# rahbar_stock_snapshot: the Rezka split was lost in 0080 (not 0137) — restored in 0143

**What was found.** `0076` narrowed `finished_konditirskiy_total` to `not is_rezka_output` and
added a separate Rezka KN figure, so Rezka output could never merge into "Konditirskiy". The
live function (2026-09-23) has neither: it splits only on `is_numberless`, so the first Rezka
pallet would have been counted as Konditerka on the Rahbar dashboard and the client panel.

**How it was lost.** `rahbar_stock_snapshot` was redefined ten times: 0068, **0076**, 0080,
0086, 0101, 0102, 0106, 0112, 0120, 0127, 0137. Grepping each body: 0076's carries the split
(8 `rezka` references); **every later body has zero**. The first loss is
`0080_rahbar_stock_snapshot_moykada.sql`, which added the Moykada tile by rewriting the
function without 0076's edit (its body has no `rezka` reference at all; whether it started
from 0068's body or a branch that predated 0076 is unverified — the effect is the same). Every
later rewrite copied its predecessor, so the loss propagated silently. The audit guessed 0137 (the set-based rewrite); that guess
was wrong — 0137 faithfully preserved an already-broken body. Nothing could notice: zero
`is_rezka_output` pallets have ever existed, so both versions returned identical numbers.

**Fix (`0143`).** Live 0137 body with only these edits: `konditirskiyKg` excludes
`is_rezka_output`; new `rezkaKnKg` (finished Rezka output); new `rezkaRawKg` (unsent raw on
`process='rezka'` serials — moved **out** of `rawKg`, because Rezka figures never sit inside
Moyka figures; `totalKg` includes both, so the total is unchanged by the move). Ichki serials
contribute 0 to `rezkaRawKg` by construction (no `storage_intake`, sent in full at mint).

**Guard for next time.** Any rewrite of a function that another migration has patched must
start from the **live** `pg_get_functiondef`, never from an older migration file — the same
lesson as the 2026-08-16 migration-history audit. Stated in `0143`'s header.

**Verified** (ROLLBACK run): with a 30 kg Standard pallet on a TEST Ichki serial,
`rezkaKnKg` = 30, `konditirskiyKg` unchanged at the 9,040 kg baseline, `rawKg` unchanged at
53,581 kg, and the pallet in stock-on-hand bucket `available` (not `awaiting_lab`).
