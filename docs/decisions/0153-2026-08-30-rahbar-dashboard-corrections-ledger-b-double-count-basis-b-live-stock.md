## 2026-08-30 — Rahbar dashboard corrections: Ledger B double-count, Basis B, live-stock bars

### The double-count, and when it actually started

`processed_output` joined `finished_pallets` with **no filter of any kind**, from the day
it was written — `0068`, commit `0491e46`, **2026-08-12**. Unchanged from that commit until
today. This is an 18-day-old defect in the original dashboard; it is **not** a consequence of
recent work, and not of the 28 August dispatch.

Reconstructed against real rows, using the cohort rule live at each date (`0068`'s
`status='final'` gate) and respecting `voided_at`, so a pallet only double-counts once it has
really been voided:

| p_to | Ledger B reported | Should have been | Overstated |
|---|---:|---:|---:|
| 2026-08-18 | 3,340 | 3,340 | 0 |
| 2026-08-19 | 3,340 | 3,340 | 0 |
| **2026-08-20** | **15,820** | **7,910** | **7,910** |
| 2026-08-25 | 16,840 | 8,930 | 7,910 |
| 2026-08-27 | 27,020 | 19,110 | 7,910 |
| **2026-08-28** | **49,940** | **25,480** | **24,460** |

First appeared **2026-08-20** — the earliest `voided_at` in the table — at which point output
was reported at **exactly twice reality**. It stepped to 24,460 kg on 08-28 with a second void
batch of 16,550 kg. A first attempt at this reconstruction applied *today's* statuses to past
dates and wrongly showed an overstatement on the 18th; corrected before reporting.

### Each exclusion, justified individually against real rows

| Exclusion | Rows | kg | Why absent from "what came out of Moyka" |
|---|---:|---:|---|
| `bekor_qilindi` | 41 | 24,460 | Void-and-remint: re-registered at the **same weight** under a new barcode, both rows present. The live row *is* the same physical product. Nothing is dropped — every kg removed is still counted via its replacement. All 41 sit on closed serials. This is the entire overstatement. |
| `storage_loss` | **0** | **0** | See below — excluded, and probably wrong long-term. |
| mint-consumed | 2 | 1,040 | `PLT-020826-034-04-1` (720 kg) / `-04-2` (320 kg), serial `020826-034`, origin `opening_stock`, minted into `240826-001`. Did not leave the building — re-minted and counted there. Both opening-stock, so the default `yangi` scope already excludes them by origin. |

No exclusion drops material that physically existed and left the building.

🚩 **`storage_loss` is excluded here and that is almost certainly the wrong long-term
answer.** Decided knowingly: zero such rows exist, both ledgers agree, reasoning recorded.
**Revisit before the first row exists, not after** — once one exists, changing this silently
restates history.

Why it is probably wrong: this project has already decided, explicitly, that storage loss is
kept separate from processing loss *so it never corrupts yield* — see the old-stock close-out
entry ("isolated from processing loss so yield figures stay clean"), whose verification
proved it: `yield_rows`, `rahbar_monthly_trends` and `rahbar_client_ranking` were "queried
before and after, byte-identical in every field". `yield_rows` achieves that by **keeping**
`storage_loss` pallets in its output (post-`0102` it filters `bekor_qilindi` only). The
pallet stays counted as production and the write-off is reported on its own line. That is the
principle the eventual answer should follow — count it in production in **both** ledgers,
surface the write-off separately.

Concrete, testable consequence of the choice made here: **the moment the first `storage_loss`
row exists, Ledger B will diverge from `yield_rows` by exactly the written-off amount, and
this migration's own `yield_rows` cross-check will start failing.** Treat that failure as the
reminder to revisit, not as a new bug.

### Basis B for Tayyor kalibrli

`processed_lines` gated on `wash_cycles.closed_at` falling inside the period (the brief said
`status='final'`; `0101` replaced that with `closed_at` on 2026-08-29 — same intent, different
column). That dropped every serial still open at period end: for August, 1 serial, **7,345 kg
of input and 7,330 kg of output invisible** — precisely the slack
`moykadaSnapshot.residualKg` had been reporting.

### Before / after on live, all scopes (2026-08-01 → 08-31)

| Figure | Before | After |
|---|---:|---:|
| `moyka.calibreKg` | 48,860 | **33,820** |
| `moyka.konditirskiyKg` | 8,460 | **6,370** |
| output total | 57,320 | **40,190** |
| `moyka.processedKg` | 34,292 | **41,637** |
| `moyka.lossKg` | **−23,028** | **1,447** |
| `moyka.lossPct` | −67.2 % | **3.5 %** |
| `moykadaSnapshot.residualKg` | 7,330 | **−15** |

`eski` is 0 → 0 throughout (no output in period). Per calibre: K1 970→1,630 · K2 6,260→4,930 ·
K4 35,600→23,570 · K6 4,740→2,980 · K8 1,290→710 · KN 8,460→6,370.

**Identities, measured after the change:** Ledger B output − Ledger C `producedKg` = **0**
(was 17,130 apart); `processedKg − calibreKg − konditirskiyKg − lossKg` = **0**. Both hold in
every scope.

⚠️ **The residual did not reach 0 as I predicted — it is −15 kg**, and the frontend renders it
whenever nonzero. It is now a small structural artifact rather than a whole missing serial:
`processed_lines` counts a serial's *whole* `sent_capped` while only the period's output is
subtracted, so the 15 kg still inside Moyka for that one serial shows as slack. Reported
rather than papered over; not fixed in this pass.

### Cross-checks against independent sources (not the other half of the same function)

- **`report_moyka_output_rows`** — Hisobot's own MOYKADAN view, no shared code with these
  RPCs: August = **40,190 kg**, exactly the corrected Ledger B output.
- **`yield_rows`** — loss 1,432 on 34,292→32,860 (closed serials only). Corrected Ledger B is
  41,637→40,190 = 1,447. Reconciles exactly: **1,432 + 15 = 1,447**.
- **`stock_on_hand_rows`** — the new `byCalibre` payload totals 17,580 (yangi) / 51,170 (eski)
  / 68,750 (hammasi), matching the view directly and the surviving tiles.

### Dashboard changes

Removed: the Eski KN (havza) tile, the whole **Zaxira tarkibi** card (Silo + donut), and the
whole **Kirim va chiqim** card. "Jami zaxira" → **"Jami yuvilgan va yuvilmagan mahsulot"**.
The per-calibre bars now show a **live balance** from `stock_on_hand_rows` instead of the
period's output — for August they showed K4 at 23,570 kg while only 960 kg was on hand.
`byCalibre` carries `type_id` so the Turlar filter still narrows them; dropping the type
dimension would have silently disabled that filter. `byType` left in the payload unused, per
instruction. Dead components removed (`Silo`, `Donut`, `TrendChart`, the four `Ledger*` rows,
`typeColor`, `LegendRow`, `TYPE_PALETTE`).

🚩 **Scope note worth a second look: removing the "Kirim va chiqim" card also removed the
three-ledger reconciliation table** (Ledger A raw, Moykada, Ledger B with its Yo'qotish row,
Ledger C dispatched/closing) — the ledgers lived inside that card, not beside it. That was the
literal instruction, and it is what was built, but it means the corrected loss figure no
longer has a table of its own. It is preserved as a sentence under the stock bars ("Tanlangan
davrda yuvishdan chiqqan … yo'qotish …"). If only the trend chart was meant to go, the ledger
table can be restored on its own.

### Old KN is no longer visible anywhere on Rahbar's dashboard — a recorded choice

With its tile removed **and** the pool excluded from the relabelled headline, **81,915 kg of
real client stock has no representation on this screen at all**. It is reachable only through
Ombor qoldig'i and Hisobot. Excluding it from the total was the right call given the tile is
gone — leaving it inside a number with nothing on screen accounting for it would be worse —
but the combination is a deliberate decision by Abdulloh, not a side effect, and it reverses
the reasoning that gave old KN its own tile a few weeks ago (v1.2x, so the pool would be
*visible* precisely because it sits outside Ledger C). Recorded here so the reversal is
findable if the pool is ever miscounted.

**No PR opened.** Branch: `claude/total-loss-finalized-serials-5jeugz`.
