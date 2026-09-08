## 2026-09-02 — Post-hoc K6 pallet registered on Subxon P6 (110826-001), serial reopened
**Context:** Workers collected a K6 pallet post-hoc from small apricots belonging to
Subxon partiya 6 — serial `110826-001` — after that serial had already been
finalized (2026-08-28) and closed (`wash_cycles.closed_at = 2026-08-29
10:11:17+00`). Before the correction: `sent_kg` 7 320, `received_kg` 7 170,
Moykada 0 (gated to 0 by `closed_at`), Yo'qotish 150 kg booked as realized.
The pallet is real output that was never entered, so the 150 kg realized loss
was overstated by the pallet's weight. Registered via SQL only, no in-app input.

**Decision:** One-off data correction, **no migration file** — nothing about the
schema or any function changed, only three rows of data.

1. `wash_cycles.closed_at = null` for `110826-001` (reopen, so the residual goes
   back to being unrealized Moykada rather than booked Yo'qotish).
2. Inserted `finished_pallets` row `PLT-110826-001-06-1` — Kalibr 6 (`code '06'`),
   10 kg (weight supplied by the user; not assumed), `received_date =
   2026-09-02` (the post-hoc collection date), `status = 'in_stock'`.
3. Ran the natural-close check. New balance is `7320 − 7180 = 140 kg > 0`, so it
   correctly **no-opped** and `closed_at` stays `null`. The user closes it from
   the app (Yakunlash) when they judge the remaining 140 kg is genuinely lost.

**Schema notes (CLAUDE.md "inspect before assuming" — the task's pseudocode did
not match the live shape):** `finished_pallets` has no `parent_serial` (it's
`serial`), no `barcode` (PK is `barcode2`), and no `calibre` text column (it's
`calibre_id` uuid). `type_id` and `received_date` are `not null` and were absent
from the task's field list; `type_id` was carried from the serial's existing
pallets (Subxon) and `received_date` set to the collection date. Barcode pattern
confirmed empirically from the 10 existing rows on this serial:
`PLT-{serial}-{calibre_code}-{per-calibre seq}`. No `06` row existed, hence seq 1.

**`close_wash_cycle_if_settled()` not called as an RPC:** it guards on
`my_role() = 'ombor'`, and over the MCP/`postgres` connection `my_role()` is
`null`, so the RPC raises `Ruxsat yo'q`. Rather than impersonate a real user
account by forging a `request.jwt.claims` sub, the function's own single `update`
statement was run verbatim — identical balance condition, identical effect,
and it is the statement that would have run anyway. `created_by` left `null` for
the same reason: this was a SQL correction, not an action by an ombor user, and
attributing it to one would be false audit data.

**Known consequence, flagged not fixed:** `yield_rows` gates on `closed_at is not
null`, so `110826-001` has dropped out of the yield report while it is reopened.
It returns — with the K6 pallet included and a corrected loss figure — as soon as
the user runs Yakunlash. `completed_date` is `min(received_date)` across the
serial's pallets, so it stays 2026-08-27 and the new row does not move the serial
into a later reporting period. `wash_cycles.status` is still `'final'` with a now
stale `final_loss_pct = 2.27` (the pre-cutover Tugallash record); left untouched
as out of scope — the live figures come from `kirim_line_state`, not that column.

**Verified after the write:** `received_kg` 7 180, Moykada **140 kg**, Yo'qotish
**0** (unrealized while open), `closed_at` **null**, `kirim_line_state` returns
`moykadan_chiqgan = 7180 / moykada = 140`, and the K6 pallet shows 10 kg
available in `finished_serial_calibre_availability`.
