## 2026-08-29 — Voided pallets excluded from five output read paths
**Context:** Follow-up to the entry above. The manager reported that "Moykadan" and
"Bekor qilindi" were double-counted on the serial passport. Root cause is not the
weight correction: the **2026-08-28 void-and-remint pass** set the old pallets to
`status='bekor_qilindi'` and minted replacements alongside them, leaving both sets as
rows in `finished_pallets`. Every read path that sums `finished_pallets.weight_kg`
without filtering `status` counts the same physical product twice. Blast radius at the
time of the fix: **8 serials, 41 voided pallets, 24,460 kg** of phantom weight — all
owned by **Global Export Company** (not Subxon, as guessed when the fix was
commissioned; there is no owner by that name — the three owners are Boysun Quritilgan
Mevalar, Global Export Company, Nukus Agro Eksport). Two of the eight (`050826-001`,
`290726-071`) were re-minted at identical weights, so they read *exactly* 2×, which is
what made the doubling visible. The six serials from the previous entry are a subset —
the fix is a filter and cannot be scoped to them, and shouldn't be.

**Decision:** One migration, `0102_exclude_voided_pallets_from_output_reads.sql`, applied
live (as three supabase entries; see the file header). Five surfaces, one rule.

- **The rule is `status <> 'bekor_qilindi'`, and only that** — deliberately NOT the
  `not in ('bekor_qilindi','storage_loss')` shape `kirim_line_state` /
  `kirim_line_calibre_output` use. A voided pallet is a bookkeeping reversal: that
  product never existed and must never appear in any sum. A `storage_loss` pallet DID
  exist and DID come back from the wash, and the passport reports it on its own
  `storageLossKg` line — folding it into the same exclusion would break the passport's
  reconciliation identity (`returned = dispatched + storageLoss + consumed +
  stillInStorage`). Currently zero-impact (no `storage_loss` rows exist at all), so this
  is a statement of intent for the next one. Flagged, not silently unified.
- **Fixed:** `get_serial_passport.finished_returned_total` (the reported bug — 290726-068
  read `returnedKg` 4,730 = 2,270 live + 2,460 voided, with the same 2,460 printed again
  as `voidedKg` directly beneath it, `SerialPassportModal.tsx:274,283`; also unclamped
  `cycles[].inMoykaKg` and de-fanged a latent negative `lossKg`); `yield_rows`
  (`output` + `calibre_breakdown`); `report_totals.total_kg_from_moyka`;
  `rahbar_stock_snapshot.output_kg`; and `client_filtered_report_rows`' `moyka_output`
  branch.
- **`client_filtered_report_rows` was the serious one** — client-facing. The portal was
  showing Global Export 57,320 kg of "Переработано" against a true 32,860, and feeding
  `client_report_totals.total_netto_kg` the same inflation. Voided pallets are dropped
  from the client **rows** entirely there, not just the totals: a client document has no
  audit-trail role for a reversal, and `get_client_report` already excluded them, so the
  two client surfaces now agree.
- **Deliberately not changed:** the voided *rows* stay in the internal Hisobot listing
  (`report_chiqim_rows` / `report_moyka_output_rows` still emit them, labelled
  `bekor_qilingan`) — that is an audit trail `ChiqimRowDetail.tsx:28` renders on purpose.
  The bug was `report_totals` summing them, so the fix went in the totals.
  `total_kg_out` was left alone after verifying it is *structurally* unreachable, not
  merely currently-zero: chiqim rows carry `date_basis` = the dispatch date,
  `report_filtered_rows` drops null `date_basis`, and a voided pallet has no
  `chiqim_pallet_consumption` row so can never acquire one (all 41 confirmed null).
  `total_count` was left alone because it counts rows *displayed*, and the voided rows
  are displayed.
- **In `yield_rows` the status test went into the aggregate `FILTER` clauses, not the
  join or a `WHERE`** — the join is a `LEFT JOIN` (a `WHERE` would make it inner and
  drop serials with no pallets yet), and `min(fp.received_date) as completed_date` must
  keep seeing every pallet or each corrected serial silently re-dates to its 2026-08-28
  remint date and moves reporting period (290726-068 would have gone 08-25 → 08-28).

**🚩 Concurrent-session hazard — the part worth reading twice.** Midway through writing
this fix, `yield_rows` changed under us: the Yakunlash work in the entry directly above
(`0101_yakunlash_realized_loss_split.sql`) was applied to the live project **by another
session, while this fix was mid-flight**, and at that moment was not yet on `main`. It
adds `serial_base.closed_at` and an `AND serial_base.closed_at IS NOT NULL` gate to
`finished_serials`. The `create or replace view yield_rows` already written here would
have silently reverted it. Caught only because a pre-apply baseline read returned 0 rows
where 6 were expected, which prompted re-dumping the live definition instead of trusting
the one dumped twenty minutes earlier — the general lesson being that on a shared live
project a definition dumped at the start of a task is **not** safe to `create or replace`
from at the end of it.

The fix was rebased onto the live definition and carries the gate forward verbatim, which
is why `0102` must stay ordered after `0101`. Since `0101` also redefines
`rahbar_stock_snapshot` and `get_serial_passport` — both rewritten here too — its own
bodies for all three objects were diffed against the three in `0102` after the merge: the
**only** differences are the `bekor_qilindi` filters (plus `pg_get_viewdef` formatting on
`yield_rows`, which is semantically identical). Nothing from `0101` is lost.

**Still open, not this migration's doing:** `yield_rows` returns **zero rows** on live
(0 of 19 wash cycles have `closed_at` set), so the Unumdorlik tab is empty. That may be
the intended behaviour of the not-yet-exercised Yakunlash flow, or a regression — it was
not changed here either way. The double count in `yield_rows` is real and now fixed, but
currently masked by that gate; it resurfaces the moment the first cycle is closed.

**Verified live, post-apply.** Passport: full-JSON hash compared per serial across all
26 serials against a pre-apply baseline — **exactly the 8 affected serials changed, the
other 18 byte-identical**, and each of the 8 now has `returnedKg` = `stillInStorageKg`
with `returnedKg(before) − voidedKg = returnedKg(after)`. `020826-034` correctly keeps
its 1,040 kg of `consumed` pallets inside `returnedKg` (18,870 returned vs 17,830 still
in storage), confirming only voided was dropped. `report_totals`: `total_kg_from_moyka`
109,530 → **85,070** (−24,460) with `total_count` (201), `total_kg_in` (139,430.4),
`total_kg_out` (46,511), `total_kg_to_moyka` (64,952) and every `state_*` column
unchanged. `rahbar_stock_snapshot`: `moykadaKg` 31,247 → **32,092** (+845, it
under-stated because the inflated output clamped `greatest(0, sent − output)` to zero),
`totalKg` 250,861.4 → 251,706.4, `rawKg`/`finishedCalibredKg` unchanged — and
`moykadaKg` now **matches `report_totals.state_moykada` (32,092) exactly**, two
independently-computed in-wash figures that disagreed before. Client portal simulated
for Global Export: 57,320 → **32,860** kg.

**No frontend changes** — every fix is in SQL, so no `tsc`/`oxlint`/build run was
warranted by this migration itself; the merge of `main` brought the Yakunlash frontend
in, so the suite was run over the merged tree instead (see below). Branch:
`claude/serial-numbers-weight-units-x4zdut`, PR #118.
