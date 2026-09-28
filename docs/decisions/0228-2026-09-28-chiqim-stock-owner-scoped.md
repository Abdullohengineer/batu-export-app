# Post-Rezka cleanup, item 2: CHIQIM stock is client-scoped

Post-Rezka cleanup, HANDOFF item 2 (FIFO and availability not owner-scoped, found in Rezka
Prompt 3). Migration `0148_chiqim_stock_owner_scoped.sql` applied 2026-09-28 (version
`20260928122956`). Stored md5 `81684b1060d2e12839c14c64d20f07f4` matches the file (5,951 bytes).

## The defect (pre-existing since 0087)

`finished_calibre_availability` summed every client's pallets per type + calibre + old/new.
`attribute_chiqim_line_fifo` drew down every client's pallets oldest-first.

Menejer's "Mavjud" hint and Ombor's "Omborda mavjud" / "Diqqat: omborda faqat X kg mavjud"
therefore counted other clients' stock. Ombor's finalize could also load another client's
pallets onto this client's truck.

Reproduced in a rolled-back dry run with TEST owners A and B (B's pallets dated 2000, so oldest).
A request for owner A took **B's** pallets on every line:

| Line | Pre-0148 FIFO took |
|---|---|
| K4 60 kg | B's K4 pallet |
| old-washed K4 50 kg | B's OLD pallet |
| Standard 30 kg | B's RKN pallet |

## Fix

A pallet's owner is its serial's order owner (`kirim_lines` → `kirim_orders.owner_id`). Every
in-stock pallet has one, checked live: 148 delivery, 5 internal_reprocess, 67 opening_stock.

- **`finished_pallet_availability`** gains `owner_id` as its last column; nothing else changes.
- **`finished_calibre_availability`** gains `owner_id` as its last column and groups by it. A sum
  across owners gives today's total.
- **`attribute_chiqim_line_fifo`** only takes pallets whose owner is the request's owner. The lab
  gate (o_tdi or a Rezka serial), the old/new split, the Rezka-draw and consumption netting, the
  oldest-first order and the shortfall error are unchanged.
- **Old stock** is scoped by the opening_stock order's owner.
- **Rezka Standard** is scoped by the Rezka serial's owner: the delivering client for Tashqi, and
  `send_kn_to_rezka`'s `p_owner_id` for Ichki.
- **`finished_serial_calibre_availability`** is untouched: it has no caller, and a serial has one
  owner.

**Frontend.** `useFinishedCalibreAvailability` selects `owner_id`. Menejer's `ChiqimForm`
`availableKg` and Ombor's `OmborChiqimTab` `availableKgFor(line, request.owner_id)` match the
request's client. `rezka-menejer.spec.ts` reads availability with the TEST owner, so it compares
like with like against the scoped on-screen "Mavjud".

**The Ombor "Yetarli emas" note** compares requested kg with loaded kg (`shortfallLines`). It
never read availability, so it is unaffected. The availability-based figures that changed are
"Omborda mavjud", "Diqqat: omborda faqat X kg mavjud" and Menejer's "Mavjud"; all now use the
scoped figure.

## Verification (live, after apply)

- **Regression.** The pre-0148 view bodies were rebuilt as queries and compared with the new
  views:
  - pallet rows: 223 before and after, 0 differing, 0 without an owner;
  - per-calibre totals summed across owners: 0 of 24 differ, 91,810 kg either way.
- **TEST fixtures, rolled back.** Owners `TEST-OWN-A`/`-B`, each with Subxon K4 100 kg, old-washed
  K4 50 kg and Standard 30 kg; request `TEST-OWN-CHQ-A`:
  - A's K4 60 → `TEST-PLT-OWN-A-K4`; old-washed 50 → `-A-OLD`; Standard 30 → `-A-RKN`. The
    Standard pallet needed no lab verdict, which re-covers Prompt 1's T3.
  - A's further 150 kg of K4 → "Yetarli mahsulot yo'q: 110.0 kg yetishmayapti", while B still
    held 100 kg.
  - Availability afterwards: A 0 / 40 / 0, B 30 / 100 / 50 (Standard / K4 / old-washed K4).
    0 consumption rows on B's pallets.
  - The fixtures added exactly +360 kg to the all-owner total.
  - Nothing persisted.

## Deployment order

The frontend reads `finished_calibre_availability.owner_id`, which exists only from 0148. 0148 is
live, so the branch is safe to deploy.
