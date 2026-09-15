# 0190 — mint_serial_from_sources: partial-consumption eligibility fix

**Date:** 2026-09-15
**Trigger:** User report — "Eski zaxirani qayta yuvishga yuborish" (Ombor, Subxon /
Global Export Company / Kalibr 6) failed with a red "Saqlashda xatolik yuz berdi."
after picking 5 old-stock pallets (~2,900 kg book, 2900 kg weighed) and clicking
"Moykaga yuborish".

## Root cause

`mint_serial_from_sources` (migration 0055, `chiqim_pallet_consumption` table-renamed
in 0091) gated pallet eligibility on:

```sql
and not exists (select 1 from chiqim_pallet_consumption cpc where cpc.barcode2 = fp.barcode2)
```

— i.e. "has this pallet ever had *any* chiqim dispatch against it, at all." That
boolean shape predates chiqim's move to fractional/partial pallet consumption
(0087, `chiqim_quantity_dispatch_fifo`). 0091 only swapped the dead
`chiqim_line_pallets`/`dispatch_manifest` names for `chiqim_pallet_consumption` when
that table was dropped; it never re-derived the check for partial quantities.

`stock_on_hand_rows` (the exact source `OldStockToMoykaForm`'s picker reads) already
handles partial consumption correctly: it nets `weight_kg - departed_kg - pending_kg`
and shows the true remainder in bucket `available`. So a pallet that had, say, 700 kg
of its 720 kg book weight dispatched via an already-completed chiqim shipment, with a
genuine 20 kg left on the floor, showed up in the picker as selectable — and was then
unconditionally rejected by the RPC the instant it was picked, because the RPC's own
check only asked "any consumption row at all," not "is there anything left."

**Live repro before the fix**, confirmed via read-only queries against production data:
pallet `PLT-020826-034-06-5` (Subxon, Global Export Company, K6). `weight_kg=720`;
`chiqim_pallet_consumption` had one row, `qty_kg=700`, against chiqim request plate
`20G167KA` (truck_type=`fura`), `ombor_finished_at`/`chiqim_departed_at()` =
2026-09-10 — i.e. fully departed, 0 kg pending. Net remainder = 20 kg, matching the
"~20 kg" shown in the screenshot's picker. Picking it alongside 4 full 720 kg pallets
(5 total, ~2,900 kg book) made `mint_serial_from_sources` count only 4/5 eligible and
raise `Pallet mavjud emas, boshqa so'rovga band qilingan yoki allaqachon ishlatilgan
(4 / 5 yaroqli)` — surfaced to Ombor as `OldStockToMoykaForm`'s generic
`err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.'` fallback text
(not otherwise changed here; out of scope — see below).

## Fix

`supabase/migrations/0123_mint_serial_from_sources_partial_consumption_eligibility.sql`
replaces the bare existence check with the same net-remaining math
`stock_on_hand_rows` already uses (`chiqim_departed_at()`, same `TEST-%` plate
exclusion):

- `pending_kg` (an active, not-yet-departed chiqim reservation on that pallet) must be
  `0`. This is intentionally *stricter* than `stock_on_hand_rows`' `available` bucket,
  which can show a net-positive remainder for display purposes even while a separate
  `band_qilingan` portion is pending on the same barcode. `mint_serial_from_sources`
  consumes the *whole* barcode in one shot (`update finished_pallets set
  status='consumed' where barcode2 = any(...)`), so re-minting out from under a live
  reservation would silently steal material already committed to that chiqim request.
  A display-only "still shows some free kg" is not the same guarantee as "safe to
  consume the whole physical unit."
- `weight_kg - departed_kg > 0` (book weight still has something left after
  fully-departed consumption only).

Applied directly to the live project (`qohoqbapevrcjqxbstxi`) with the user's
confirmation, per this repo's "ask before applying migrations to the live project"
rule.

## Verification

1. **Read-only, against the real stuck pallets** (no writes): re-ran the new
   eligibility subquery against the exact 5 barcodes from the report. Result:
   `v_ok=5, v_expected=5` — all five now pass, matching what the picker already showed.
2. **Full round-trip, disposable fixtures only** (per this repo's "never touch real
   seeded stock" testing rule — `send_old_stock_to_moyka` is irreversible: it consumes
   pallets and mints a serial): built a `TEST-`-prefixed source order/pallet
   (`TEST-PLT-MINT-FIX-1`, 100 kg book) with an 80 kg fully-departed partial
   consumption from a disposable `TEST-CHIQIM-FIX-0123` fura request, leaving a 20 kg
   remainder — the same shape as the real bug. Called `send_old_stock_to_moyka` under
   the real TEST Ombor auth identity (`profiles.id=b13cd533-...`, phone `900000004`,
   via `request.jwt.claims`/`auth.uid()`, not a superuser bypass) to exercise the exact
   `my_role()` gate the app hits. Result: minted serial `150926-002`,
   `declared_qty=20` (the weighed figure, not book), `finished_pallets.status=
   'consumed'`, `serial_mint_sources` row (`source_kind='pallet'`), `wash_cycles`
   row (`status='active'`), `moyka_sends` row (`qty_kg=20`), and the auto-note all
   created correctly — the same shape a real send produces.
3. **Cleanup — deliberately full DELETE, not void.** `mint_serial_from_sources`
   hardcodes its minted `kirim_orders.plate = 'QAYTA-ISHLASH'` (deliberately *not*
   `TEST-%`, so a real internal-reprocess re-wash isn't excluded from yield/loss/
   re-wash trend reports — see 0055's own comment). That means the fixture's minted
   order/serial/wash_cycle/moyka_send/note were **not** caught by any `TEST-%` report
   filter and, left in place, would have shown up as a phantom 100→20 kg re-wash
   against a real owner and real product type in every processing-aggregate report
   (`yield_rows`, `wip_rows`, rahbar trends) — exactly the class of leak this
   project's origin-filtering rules exist to prevent. This repo's "void, never DELETE"
   fixture-cleanup convention assumes the entity has an app-native void path
   (`wash_cycles.status='voided'`, `finished_pallets.status='bekor_qilindi'`,
   `chiqim_requests.voided_at`); several of the rows this test created
   (`moyka_sends`, the minted `kirim_orders`/`kirim_lines`) have no such path in this
   schema. Given the choice between leaving synthetic rows with zero real audit value
   polluting a real owner/type's production reports, or removing every row this
   MCP-driven verification inserted, this entry records a deliberate exception: every
   fixture row (source pallet/order/line, `TEST-CHIQIM-FIX-0123` request/line/
   consumption, minted order/line/pallet-source/wash_cycle/moyka_send/note) was
   `DELETE`d, confirmed by a final zero-row sweep. Nothing this test touched was a
   real business record; the "never DELETE" rule protects real audit trail, which
   this never was.

## Not in scope here

`OldStockToMoykaForm`'s catch block (`err instanceof Error ? err.message : '...'`)
showed the generic Uzbek fallback rather than the RPC's specific
`Pallet mavjud emas...` message in the reported screenshot. Investigated only as far
as confirming the DB-level fix resolves the underlying failure; the frontend error-
message swallowing (if it is one — `@supabase/supabase-js`'s `PostgrestError` is
expected to extend `Error`, so `err.message` should normally surface real RPC error
text) is flagged, not fixed, per this task's scope discipline.
