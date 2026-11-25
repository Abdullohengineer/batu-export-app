# 0255 — "1 kg tannarxi" was blank: Moyka kg calls timed out

2026-11-25, owner report: "I can't see tannarxi calculations for given months."

## Root cause

"1 kg tannarxi" is xarajat ÷ Moyka output kg. The kg came from the full
Hisobot engine (`report_totals`), called once per month. The Moliya overview
needs 7 months, plus the forecast's current month, so it fired about 7 of
those heavy calls at once.

- The API log showed bursts of `POST /rpc/report_totals` returning **500**,
  with only one 200 per burst.
- The Postgres log showed `canceling statement due to statement timeout`.
- So kg came back missing, and the screen showed "—".

It was not data or permissions: as buxgalter, rahbar and menejer, the
engine returns 104,510 kg for October when called alone.

`report_totals` builds per-serial state bundles (`kirim_line_report_bundle_set`,
`rezka_serial_state_set`) on top of the rows. Finance needs only one sum.

## Fix

- **`moyka_output_kg_by_month(owner, from_month, to_month)`** (migration
  0170, applied live) returns every month of a range in one call.
  - It is the same sum as `report_totals.total_kg_from_moyka`: `qty_kg` of
    the `report_filtered_rows_v2` `'moyka_output'` rows, one window per
    calendar month.
  - Per-month windows are deliberate. One wide window gave different
    numbers (August 24,400 vs 40,030), because the row source groups output
    per serial within its window.
  - Origin handling is whatever the row source already applies; nothing is
    re-implemented.
  - It is plpgsql with `force_custom_plan`, the same constant-folding fix
    as `report_totals`. It is not security definer: the caller's RLS
    applies.
  - The range is capped at 36 months.
- **`useMoykaKgSeries`** now makes one request for the whole range.
  **`useMoykaOutputKg`** (Tushum, Oyni yopish, forecast) uses the same
  function for one month.

## Verification

- **Live, as Muborak:** April–November in one call took 260 ms. It returned
  August 40,030, September 111,890, October 104,510 and November 74,530 kg,
  identical to `report_totals` month by month.
- **UI against a fake backend:**
  - Moliya 32/32, including a new check: the overview makes ≤ 2
    `moyka_output_kg_by_month` requests and **0** `report_totals` requests;
  - Oyni yopish / Kutilayotgan 36/36;
  - Tarix 14/14.
- **Checks:** build passes, 107/107 unit tests, lint and the RPC check pass.

## Resulting figures (live data)

| Month | 1 kg tannarxi | Margin vs the 7,468.75 rate |
|---|---|---|
| August | 10,603 | −3,134 |
| September | 7,552 | −83 |
| October | 10,347 | −2,879 |
| November (25 days) | 348 | partial: November's big payments are not in yet |
