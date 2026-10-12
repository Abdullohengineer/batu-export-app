# 0239 — "omborda qolgan" caption pointed at hero-tile snapshot, not ledger.finished.closingKg

2026-10-12

## Problem

Rahbar Bosh sahifa's "Olib ketilgan tayyor mahsulot" card caption
("Jami olib ketilgan ... kg · omborda qolgan ... kg") read
`ledger.finished.closingKg` from `rahbar_dashboard_ledger` — a parallel,
period-scoped calculation over `finished_pallets` that duplicated what the
hero tiles above it (`snapshot.finishedCalibredKg` + `snapshot.konditirskiyKg`
from `rahbar_stock_snapshot`) already showed. The two numbers could disagree
(seen live: caption showed 80,790 kg while the hero tiles' true combined
on-hand was 63,040 kg).

## Ambiguity found and resolved

The task asked for the fixed caption to be "scope-independent (always full
warehouse), regardless of the Zaxira toggle," while also stating the correct
target was 63,040 kg. Checked live against production:

| p_scope | finishedCalibredKg | konditirskiyKg | combined |
|---|---|---|---|
| yangi (page default) | 53,250 | 9,790 | **63,040** |
| eski | 33,080 | 0 | 33,080 |
| hammasi | 86,330 | 9,790 | 96,120 |

63,040 kg only comes out of `p_scope='yangi'` — not a scope-independent
"full warehouse" total (that's 96,120 kg). The two stated requirements
couldn't both hold. Asked Abdulloh: chose to have the caption mirror
whatever `snapshot` the hero tiles are already using (same hook call,
inherits the active Zaxira toggle) rather than pin to `hammasi`. This
guarantees the caption can never again diverge from the tiles above it —
"scope-independent" in the sense of never drifting from its own source,
not in the sense of ignoring the toggle. Verified this reads 63,040 kg
today under the default Yangi toggle.

## Fix

Added `finishedOnHandKg` prop to `OmborHozirSection` (shared between
RahbarHome and ClientPanelTab), fed by `snapshot.finishedCalibredKg +
snapshot.konditirskiyKg` — the exact fields the hero tiles read directly —
not `stockCalibredTotal`/`stockKnTotal` (those re-sum the Turlar-filtered
bars and would drift under a product-type filter the hero tiles ignore).
Caption now reads `finishedOnHandKg` instead of `ledger.finished.closingKg`.
`ledger.finished.dispatchedKg` is unchanged (snapshot carries no
period-dispatched figure).

No SQL changed. `rahbar_dashboard_ledger` still computes `finished.closingKg`
for its own internal identity/diagnostics; it's simply no longer read by
this caption.

## Known, deliberately out of scope

Separately flagged in an earlier session (not re-litigated here per the
task's explicit scope line): `pallet_base` inside `rahbar_dashboard_ledger`
has no `TEST-` exclusion, unlike its sibling event CTEs patched by 0151.
Zero kg impact confirmed at the time, but still a latent gap in that SQL —
untouched by this fix, which only changes the frontend.
