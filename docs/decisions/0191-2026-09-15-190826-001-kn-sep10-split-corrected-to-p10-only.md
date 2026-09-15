# Revert wrongful P11 KN split from 0190, correctly scope the Sep 10 split to P10 only

## Context

Corrects a scoping mistake in
`docs/decisions/0190-2026-09-15-190826-001-002-kn-rounding-and-sep10-split.md`.
Full SQL archived at
`docs/data-corrections/2026-09-15_190826-001-002-kn-revert-p11-correct-p10-sep10-split.sql`.

## What went wrong

The operator's requirement — "total KN volume output that came out on Sep
10 is 2,260 kg" — was scoped to P10 (serial 190826-001, Partiya 10) only.
`0190` misread this as a factory-wide total across all serials, and
sourced the missing 260 kg by splitting **P11's** (serial 190826-002,
Partiya 11) own `PLT-190826-002-KN-1` pallet — a serial the operator never
asked to touch. Operator caught this: *"i have added partiya 11 subxon
too, i wanted all 2260 kg belong to p10, not 2000 for P10 and 260 for
P11. i never asked about p11."*

## What changed

**Part 1 — revert the wrongful P11 split entirely.**
`PLT-190826-002-KN-3` (260 kg, 2026-09-10, inserted in error) deleted.
`PLT-190826-002-KN-1` restored from 2,310 kg back to 2,570 kg — its
correctly-rounded value from `0190`'s own first, legitimate correction,
before the erroneous split. P11 is now exactly where `0190`'s rounding fix
alone left it: untouched beyond that, loss back to 692 kg.

**Part 2 — apply the same, already-approved split mechanism, correctly
scoped to P10's own pallets.** `PLT-190826-001-KN-1` (910 kg, dated
2026-09-09) reduced to 650 kg; a new `PLT-190826-001-KN-3` (260 kg, dated
2026-09-10) created. `PLT-190826-001-KN-2` (2,000 kg, 2026-09-10)
untouched — already correctly rounded. P10's own total KN output
(910+2,000 = 2,910 before this entry; 650+260+2,000 = 2,910 after) is
unchanged, so its 685 kg loss (confirmed in `0190`) is unaffected.

The underlying mechanism — split within one serial's own pallets rather
than redistribute across serials, to avoid misattributing physical output
— was already operator-approved in `0190`; this entry only corrects
*which* serial it was applied to.

## Result

P10's own Sep 10 KN total = 2,000 + 260 = **2,260 kg**, entirely on P10.
Factory-wide Sep 10 KN total is also 2,260 kg now, since P11 contributes
nothing to Sep 10 any more. No Kalibr pallets touched at any point —
confirmed live, both before and after this correction, that
`PLT-190826-001-02-1` (Kalibr 2, 250 kg, dated 2026-09-10 — the operator's
own reference point) is unaffected.

## Verification

Dry-run (`BEGIN...ROLLBACK`) before applying, using `client_serial_loss_kg`:

| | Before this entry | After |
|---|---|---|
| P10 (190826-001) loss | 685 kg | **685 kg** (unchanged) |
| P11 (190826-002) loss | 692 kg (wrongly, via the split) | **692 kg** (restored, split fully reverted) |
| P10's own Sep 10 KN | 2,000 kg | **2,260 kg** |
| Factory-wide Sep 10 KN | 2,260 kg (2,000 P10 + 260 P11) | **2,260 kg** (all P10) |
| Sep 10 Kalibr-2 | 250 kg | 250 kg (unchanged) |

Applied for real after the dry-run matched. Live re-verification post-apply
confirmed identical figures. Four paired `audit_log` entries (the P11
delete + restore, the P10 update + insert) cover every row touched by this
correction.

## `0190` left as-is, not edited

Per this session's established convention for correcting a prior entry
(see `0180`, which reverted `0179` without editing `0179` itself): `0190`
stays as the historical record of what was actually done at the time,
right and wrong parts both. This entry is the pointer explaining what was
wrong and what superseded it — never silently rewritten into `0190` itself.

## Related

- `docs/decisions/0190-2026-09-15-190826-001-002-kn-rounding-and-sep10-split.md`
  — the entry this corrects.
