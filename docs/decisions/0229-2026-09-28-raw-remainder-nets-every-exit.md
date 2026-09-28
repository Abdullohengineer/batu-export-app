# Post-Rezka cleanup, item 3: raw remainder nets every exit

Post-Rezka cleanup, HANDOFF item 3 (`hasRawRemainder` ignores raw dispatch, found in Rezka
Prompt 3). Frontend only, no SQL.

## The defect

`hasRawRemainder(actualQty, moyka_sent)` = effective raw − Moyka sends. It decided two things:
- membership of Ombor intake Window 2 ("Qabul qilingan", with its "Qoldiq X kg" line);
- the Moyka half of the Moykaga nav badge.

It ignored raw that left on a Xom CHIQIM truck, and (for Moyka serials) Rezka sends. Every picker
already used `useMoykaSerials`' `available`, which nets all exits, so the window and the badge
disagreed with the picker. `MoykaSendSection.tsx`'s own header comment acknowledged the gap.

## Fix: one figure, computed once

`hasRawRemainder(serial)` is now `serial.available > 0`. `available` is the hook's existing
figure: effective raw − moyka_sends − raw dispatched − rezka_sends, floored, and 0 once an
old-raw line is closed out. No new arithmetic.

Call sites:
- **`OmborIntakeTab` Window 2** passes the serial's `useMoykaSerials` row; its "Qoldiq" line
  shows the same `available`.
- **`OmborHome`'s Moykaga badge** is one `moykaSerials.filter(hasRawRemainder)`, replacing the two
  per-process counts. Rezka's count was already `available > 0`.
- **Section mirroring** between §5.1 Window 2 and §5.2 Window 1 holds byte-for-byte again.
  `MoykaSendSection`'s comment is updated.

Unit tests are rewritten onto the new signature, with three new cases:
- full Xom dispatch;
- part to Moyka, the rest to Xom;
- Tashqi Rezka sent in full.

89 pass.

## Effect on live data (2026-09-28)

Every serial where the old and new predicates disagree, from `storage_intake` with the hook's
arithmetic. Exactly 10, all leaving; none flips the other way:

| Serial | Kind | Input | Moyka sent | Xom dispatched |
|---|---|---|---|---|
| 280726-029 | real | 6,427 | 2,218 | 4,209 |
| 290726-068 | real | 7,612 | 2,412 | 5,200 |
| 290726-069 | real | 8,072 | 2,284 | 5,788 |
| 290726-070 | real | 3,256 | 617 | 2,639 |
| 290726-072 | real | 7,605 | 2,239 | 5,366 |
| 280926-023 / -030 / -039 / -046 / -053 | TEST (`rezka-menejer` runs) | 10 each | 0 | 10 each |

All ten were in intake Window 2 and the Moykaga badge with nothing left in storage. They leave
both now, so the badge drops by 10.

The TEST rows are the item's required check, "a Xom dispatch of a TEST raw serial removes it from
Window 2 and the badge", carried out by the real app flow in `rezka-menejer` test 2.
