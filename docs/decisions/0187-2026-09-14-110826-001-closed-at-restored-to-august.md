# Restore 110826-001's wash_cycles.closed_at to August

## What happened

Following `0186`'s Moykada/Yo'qotish period-scoping, the operator noticed
serial `110826-001` showed `Moykada 140 kg` in August with no loss, and
asked why — expecting the 140 kg to already be a recognized August loss.

Investigation: `wash_cycles.closed_at` for this serial was
`2026-09-02 09:51:17+00`, not an August date. Per `docs/decisions/0161`:
the serial finalized 2026-08-28 and closed 2026-08-29 (`10:11:17+00`), then
got **reopened** (`closed_at → null`) on 2026-09-02 to register a post-hoc
K6 pallet (10 kg) that workers had physically collected but never entered.
Confirmed live: that pallet's `received_date` is actually `2026-08-28`, not
the `2026-09-02` collection date `0161`'s own text described — so every
physical event for this serial (arrival, moyka send, every output pallet)
happened in August. The serial was re-closed the same day
(`2026-09-02 09:51:19+00`), presumably via a real Yakunlash click once the
correction landed, which is what pushed the loss into September under
`0186`'s new closed_at-gated design — even though nothing physical happened
in September. The only September row for this serial at all is an
unrelated dispatch (a truck taking one already-produced pallet on
2026-09-12), which is why the loss surfaced on a CHIQIM row instead of
anywhere visible under a MOYKADAN filter.

## Correction

Restored `closed_at` to its pre-reopen, already-documented value —
`2026-08-29 10:11:17+00`, quoted verbatim in `0161`'s own text — now that
the K6 pallet the reopen existed for is already reflected in
`finished_pallets`. This is not a guess: it's the exact timestamp that was
there before the correction-driven reopen, restored now that the
correction is folded into the balance it was reopened to fix.

This does **not** change the loss amount. `client_serial_loss_kg` is a
lifetime sum (`sent − calibre output − KN output`) unaffected by which
exact date `closed_at` carries — only *which period recognizes it* depends
on the date. 140 kg either way; the correction moves its recognition back
to August, where the material was actually, physically accounted for.

Applied via a direct `UPDATE`, single row, paired `audit_log` entry (same
convention as every other correction this session) — archived at
`docs/data-corrections/2026-09-14_110826-001-closed-at-restore-to-august.sql`.

## Verification

- Dry-run (`BEGIN...ROLLBACK`) before applying, then applied for real.
- Live `report_query_page`, no direction filter, serial `110826-001`:
  - August (all 5 rows this serial owns — kirim, moyka_send, 2× chiqim,
    moyka_output): `state_moykada=0, state_yoqotish=140` — matches the
    operator's ask exactly.
  - September (the one chiqim dispatch row): `state_moykada=0,
    state_yoqotish=null` (blank) — no longer double-recognized.
- Full-dataset invariant sweep (every serial with a wash cycle, every
  month January 2025–September 2026), re-run after this correction:
  **0 violations**.

## Note for future reference

This is the second time `110826-001` specifically has needed a data
correction after a reopen/reclose round-trip (`0161`, now this entry) —
not a pattern to generalize into a code change (the underlying design in
`0186` is sound: it correctly reflects whatever `closed_at` says), but
worth knowing if this serial comes up again. A reopen-then-reclose that
straddles a month boundary will always move loss recognition to the
reclose month unless `closed_at` is deliberately set back to reflect when
the material was actually last touched, as done here.

## Related

- `docs/decisions/0161-...-post-hoc-k6-pallet-registered-on-subxon-p6-110826-001-serial-reopened.md`
  — the original reopen this entry's restored value comes from.
- `docs/decisions/0186-2026-09-14-moykada-yoqotish-period-scoping.md` — the
  period-scoping design this correction's numbers now correctly exercise.
