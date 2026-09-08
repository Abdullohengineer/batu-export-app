## 2026-08-31 — Hisobot: Yo'qotish column + Rahbar "kalibrli" tile labelling
**Context:** Two asks in one prompt. (a) "On Rahbar's main dashboard, kalibrli is
showing 11210 but it should show 17580 — see why it's doing and fix it." (b) "Add
yield loss figure as another column on Hisobot, so we can see total at the top bar,
but also per line loss as it's calculated per serial line."

### (a) The kalibrli tile: investigated, no defect, labels fixed instead

**11,210 kg is correct**, and nothing about it was changed. Traced against live rows,
scope `yangi` (the default):

| | kg |
|---|---|
| K1–K8 pallets ever produced (`delivery` + `internal_reprocess`, `in_stock`) | 33,820 |
| departed on the single real dispatch (request `d431…5865`, plate 4921AA80, `olib_ketildi`, gate-completed 2026-08-30) | 22,610 |
| **remaining** | **11,210** |
| KN pallets, none ever dispatched | 6,370 |
| **11,210 + 6,370** | **17,580** |

So the "should be" figure is exactly the tile plus the Konditerka tile standing next
to it. It is also, to the kilogram, the two sentences already printed lower on the
same page: `Hozir omborda 17,580 kg tayyor mahsulot` (the live per-calibre bars'
own footer) and `omborda qolgan 17,580 kg` (`ledger.finished.closingKg` = 0 opening +
40,190 produced − 22,610 dispatched). Every figure on the screen agreed with every
other one; what did not agree was the **wording** — `Tayyor · kalibrli` reads as
"finished product" to anyone not holding the K1–K8-vs-KN distinction in their head,
and the screen offered nothing to correct that reading.

Checks run before concluding it was a labelling problem, not arithmetic — each one
could have produced a real 6,370 kg gap and none did: no orphan `finished_pallets`
(0 rows with no matching `kirim_lines`), no null `calibre_id` (0 rows), no pallet
mis-flagged `is_old_stock` against its order's `origin` (the `eski` scope's 51,170 kg
matches the `opening_stock` gross exactly), no `TEST-` plate exclusion moving the
number (gross is 33,820 with and without the filter), no reserved-but-undeparted
(`band_qilingan`) kilograms hiding anywhere (`pending_kg` is 0 across the board), and
no `is_numberless` misclassification (`calibres` has exactly one KN + one RKN, and
RKN has never produced a pallet).

**Decision — put to the user, who chose it explicitly: keep 11,210, sharpen the
labels.** The alternatives offered were (i) redefine the tile as all finished stock
(17,580, retitled `Tayyor mahsulot`) and (ii) add a sixth `Tayyor · jami` tile. Both
were declined. Changed in `RahbarHome.tsx`, display only, no query and no migration:

- tiles retitled `Tayyor · kalibrli (K1–K8)` and `Konditerka (KN)`, with captions
  `konditerkasiz` and `kalibrlidan alohida`;
- the bars' footer now spells the split out — `… tayyor mahsulot — kalibrli 11,210 kg
  + konditerka 6,370 kg, olib ketilgani chegirilgan`. 🔒 Those two halves are derived
  from `stockByCalibre`/`stockKn`, the **same Turlar-filtered arrays the bars above
  are drawn from**, deliberately not from `snapshot.finishedCalibredKg` /
  `konditirskiyKg` (which the Turlar picker does not narrow) — otherwise selecting a
  product type would make the sentence describe a different set than the bars it
  annotates, which is the same class of mismatch this whole entry is about;
- the dispatched section's closing figure now reads `omborda qolgan 17,580 kg
  (kalibrli va konditerka birgalikda — yuqoridagi Tayyor · kalibrli katakchasi faqat
  K1–K8ni ko'rsatadi)`, naming the tile it is most likely to be compared against.

### (b) Hisobot `Yo'qotish, kg`

**Which figure.** `reportQuery.ts`'s own `SerialState` comment had said since
2026-08-15 that "Yo'qotish deliberately not included — no canonical per-serial
loss-in-kg figure exists yet." That premise expired on 2026-08-29: migration `0101`
(Yakunlash, realized-vs-unrealized split) created exactly one —
`client_serial_loss_kg(serial)` — `NULL` while the wash cycle is open, the signed
booked figure once `wash_cycles.closed_at` is set. Reused unchanged, the same way
`0098` reused `kirim_line_state`'s basis for the K1–K8/KN columns instead of
re-deriving output. SPEC.md §3.2.4's exclusion sentence is struck and superseded, and
the `SerialState` comment rewritten, rather than left contradicting the code.

**Why that function despite the `client_` prefix.** The prefix is historical, not a
scope: it takes a serial and reads `wash_cycles` + `client_calibre_split`, and
`client_calibre_split`'s `base_pallets` is character-for-character the same exclusion
set `kirim_line_state`'s own `base_pallets` uses (voided / `storage_loss` /
`serial_mint_sources`-consumed pallets dropped). Confirmed by reading both bodies,
then confirmed empirically before writing the migration: on all 10 closed serials,
`client_serial_loss_kg(serial) = moykaga_yuborilgan − moykadan_chiqgan` exactly. That
identity is the point of reusing it — the new column can never disagree with the two
neighbouring columns a reader will subtract by eye.

**Why not `yield_rows.loss_kg`.** Same closed-at gate, same formula, **different
set**: `yield_rows` excludes `origin = 'opening_stock'` and `TEST-` plates per
CLAUDE.md's processing-aggregate rule, while Hisobot is a row-level ledger of whatever
the filter selects, opening stock included. Clipping the column to that cohort would
blank it on rows Hisobot deliberately shows. The consequence — this chip and Yield's
own total can read differently when opening-stock serials are in the filtered set — is
written into §3.2.4 so it is never mistaken for a discrepancy.

**🚩 Default-VISIBLE, against this family's own precedent.** Every other serial-state
column (all 16) is default-hidden behind the Ustunlar picker. This one is not: the ask
was for the total to be *on the strip*, and `TotalsStrip` only chips volume columns
that are currently visible, so default-hidden would have meant re-ticking a box on
every page load (column visibility lives in `FilterState`'s ref'd Map, which dies on
reload by design). Recorded as a deliberate deviation, not an oversight.

**Null handling, the one real trap.** `state_yoqotish` is the first `state_*` column
that is legitimately NULL on a row that *has* a serial (an open wash cycle) — the
other 16 come back together and `mapState` nulls the whole object off
`state_qabul_qilingan` as a proxy for all of them. So it is mapped with `num()`, not
`Number()` (`Number(null)` is `0`, which would render "nothing was lost" for every
serial still in the wash), and `zeroState()`'s fallback sets it to `null`, not `0`,
for the same reason. Rendered via `formatLoss.ts` in both the cell and the chip, so a
surplus reads `+50 kg` rather than a bare negative; exported to Excel as a raw signed
number so the column stays summable there.

**Identity this closes.** With `0101`'s `Moykada` gating (0 once closed), the four
columns now reconcile:
`Moykaga yuborilgan = Moykadan chiqgan + Moykada + coalesce(Yo'qotish, 0)`.
Open serial → gap in `Moykada`, `Yo'qotish` is `—`. Closed serial → `Moykada` is 0,
gap booked in `Yo'qotish`. Never both, so the two can never double-count the same kg.

### Verified — live, after applying `0107` (asked and approved before applying)

Plain-language walkthrough of the verification, in the order it happened:

1. Read the live `rahbar_stock_snapshot` for all three Zaxira scopes. Expected the
   `yangi` tile's 11,210. Found `finishedCalibredKg: 11210`, `konditirskiyKg: 6370` —
   the reported "wrong" number and the missing 6,370 sitting right beside it.
2. Recomputed the same figure straight from `finished_pallets` + `chiqim_pallet_consumption`,
   bypassing the view. Expected 11,210 if the view was right. Found gross 33,820,
   departed 22,610, pending 0, remaining **11,210** — view confirmed correct.
3. Read `rahbar_dashboard_ledger('2026-07-15', today, 'yangi')`. Expected to find where
   17,580 comes from on this page. Found `finished.closingKg: 17580` — so both numbers
   the user was comparing are printed by the same screen, and both are right.
4. Applied migration `0107` to the live project (`apply_migration`, one transaction).
   Expected `{"success": true}` with no dependent object failing. Got it.
5. Called `report_totals` over 2026-07-01…08-31, all six directions, no other filter.
   Expected the four-column identity to close at 0. Found 148 rows / 21 distinct
   serials, `moykaga_yuborilgan 65,652` = `moykadan_chiqgan 40,190` + `moykada 24,030`
   + `yoqotish 1,432`, **slack exactly 0**.
6. Called `report_query_page` over the same filter and read the per-row values.
   Expected a booked figure on closed serials, `—` on open ones, `—` on serial-less
   rows. Found `050826-001` 220, `110826-001` 150, `150826-001` 567, `240826-001` 20,
   `280726-029` 58, `290726-068` 50, `290726-069` 45, `290726-070` 27, `290726-071` 242,
   `290726-072` 53 — each repeated identically across that serial's KIRIM, CHIQIM and
   CHIQIM (xom) rows, which is the serial-state semantics working. All three
   `chiqim_old_kn` rows: NULL. All open serials (`110826-002`, `110826-003`,
   `180826-001`, `190826-001`, `190826-002`): NULL, with their gap showing under
   `Moykada` (15 / 7,190 / 7,960 / 8,165 / 700 kg) — never counted twice.
7. Filtered to the single serial `150826-001` — the Isfara P3 case migration `0101`'s
   own header names. Expected 7,947 − 7,380 = 567. Found `state_yoqotish 567`,
   `state_moykada 0`, one distinct serial. That is the per-line figure the ask
   describes, and the 567 kg that was previously stuck as "still in Moyka forever".

`tsc -b` clean, `oxlint` clean (only the two pre-existing
`react(only-export-components)` warnings on `AuthProvider.tsx`/`FilterState.tsx`,
present on `main` before this diff), `vite build` clean, 72/72 unit tests pass.

⚠️ **No Playwright run, and therefore no e2e walkthrough.** This clone has no `.env`
or `.env.test` (only `.env.example`), so the app cannot bootstrap against Supabase and
no test-role login can be driven — the same blocker recorded in the two entries above
this one. Everything above is verified at the SQL layer against real data and through
a clean production build; **the rendered column, the strip chip and the reworded
Rahbar tiles have not been seen in a browser.** That is the first check to run in an
environment that has credentials.

🚩 **Adjacent, flagged and fixed (one word, inside a sentence this diff was already
rewriting):** the bars' footer still ended `Konditirskiy alohida qator.` — the last
rendered string the 2026-08-30 "Konditerka rename (display only)" commit missed. Every
other surviving `Konditirskiy` in `src/` is a TS field name, a comment, or
`barcodeLabel.ts`'s deliberate both-spellings match, none of them rendered. Now reads
`Konditerka alohida qator.`, matching the retitled tile two rows above it.

🚩 **Adjacent, flagged not fixed (CLAUDE.md scope discipline):**
- `SPEC.md`'s header still reads `**Version:** 1.40` while the changelog has since
  reached 1.44. v1.41–1.43 each added a changelog row without bumping the header;
  this entry follows that same pattern rather than changing it unilaterally.
- The legacy single-`text` `p_directions` overloads of `report_query_page` /
  `report_totals` do **not** get the new column. Deliberate, and the same call `0098`
  made: the frontend only ever invokes the `text[]` pair, and PostgREST resolves by
  parameter name so the two never collide.
