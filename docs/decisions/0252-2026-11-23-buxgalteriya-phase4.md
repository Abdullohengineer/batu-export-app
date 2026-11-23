# 0252 — Buxgalteriya Phase 4: Moliyaviy ko'rsatkichlar (output side)

2026-11-23. Follows 0251. Built against the mockup artboards Overview and
CategoryDetail, using the app's own components (0249). There is no
migration: the output side only reads tables that already exist.

## One definition of the period figures (`src/lib/financeMetrics.ts`)

Overview, CategoryDetail and Oyni yopish all compute from this module, so the
same month shows the same numbers everywhere. Everything is grouped by
`period_month`.

- **Daromad.** This is the brief's earnings definition, applied accrually:
  - **Moyka output kg × that month's moyka rate**, plus any non-Moyka
    (Rezka / other) cash-ins for the period.
  - The current month therefore shows earnings before Global Export pays
    (it pays a month in arrears). This matches the mockup:
    12,500 × 3,864 = 48.3M.
  - A month with **no moyka rate** falls back to its cash-ins, and the
    Overview says so ("stavkasi belgilanmagan — daromad tushumlar bo'yicha").
    Only Nov 2026 has a rate today.
  - 🚩 **Change to Phase 3:** Oyni yopish now uses this same definition.
    Before, it showed cash-ins only, so the two screens would have
    disagreed for any month with a rate.
- **Xarajat:** confirmed expenses only. Pending auto-posts never count.
- **1 kg tannarxi** = Xarajat ÷ Moyka kg. **Marja** = rate − tannarxi.
- **Moyka kg:** from the existing `report_totals` engine, the same call
  Tushum uses. `useMoykaKgSeries` shares its cache entries with
  `useMoykaOutputKg`.

## Overview (`/<role>/moliya`; buxgalter, rahbar, menejer)

- **Period picker:** the last 12 months, with a status suffix (joriy /
  ochiq / yopilgan / qayta ochilgan). The choice is kept in the URL (`?m=`),
  so drilling into a category keeps the period.
- **Tiles:**
  - Umumiy pul qoldiq: today's bank + kassa.
  - `<Oy>` sof foyda: with Daromad and Xarajat, and % against last month.
  - 1 kg tannarxi: with % against last month and the margin against the
    rate.
- **Chart:** the last 6 months up to the selected one, with five tabs:
  Daromad va xarajat, Faqat xarajatlar, 1 kg tannarxi, Sof foyda, and
  Xarajat turlari bo'yicha (stacked by expense type).
  - Plain SVG; the app has no chart library.
  - Palette: the dataviz reference slots 1–4, run through
    `validate_palette.js` in light and dark. Light mode warns on contrast
    for slots 3 and 4, which is covered by the legend and the value readout.
  - Hover or tap a month to read its values. A screen-reader table mirrors
    the chart.
- **Xarajatlar tarkibi:** spend by category for the period, with shares,
  including "Kategoriyasiz". Each row opens CategoryDetail. "Batafsil tarix"
  goes to Tarix.
- **Balanslar:** every account.
  - Bank: % against the balance at the end of last month (new
    `prevMonthBalance` in `useAccountBalances`). A change that rounds to 0
    reads "≈0%".
  - Kassa: "oyiga ~X aylanma" (average monthly spend).
  - Utilities: "~N oy" cover, with ⚠ when low.
- **Kutilayotgan majburiyatlar:** pending obligations with days left and the
  per-day amount. "+ Qo'shish" appears for the buxgalter only.
- **Zahira tavsiyasi:** 🔒 **owner decision 2026-11-23: obligations only.**
  The minimum balance is the sum of pending obligations, compared with bank
  + kassa ("yetarli ✓" or "X yetishmaydi ⚠").
  - The mockup's text contradicted itself: a 58M headline, but a breakdown
    of 58M + 42.8M.
- **Keyingi oy prognozi:** 🔒 **owner decision 2026-11-23: the current
  month's pace.** This month's Moyka kg and confirmed expenses so far are
  scaled to a full month; income uses the latest moyka rate. The card says
  it is less accurate early in the month. "Prognozni sozlash" is omitted
  (0249).

## CategoryDetail (`/<role>/moliya/kategoriya/:id`; `none` = uncategorized)

- **Breadcrumb and period picker.**
- **Tiles:**
  - `<Oy>` jami;
  - **6 oy o'rtacha**, averaged over the window's months that have any
    entry at all, so months before the module existed don't drag it down;
  - O'tgan oyga, as % and as an amount;
  - Jamidagi ulushi.
- **Chart:** the 6-month trend.
- **Qabul qiluvchilar:** receivers for the period with shares. An
  obligation auto-post has no receiver, so it is shown by its name.
- **All entries:** payment date, receiver, type, amount, account, period,
  with an Excel export.
- **The "To'lov sanasi ≠ Davr" note.**
- **Not built:** the mockup's placeholder row "Premiya … −0 yoki qo'shish".
  It has no data meaning. Adding entries happens on the Xarajat tab.

## Verification

- **Unit tests:** `financeMetrics.test.ts`, 5 tests covering:
  - the income basis, including 74,530 × 7,468.75 = 556,645,938;
  - confirmed-only expenses;
  - cost per kg (44.35M ÷ 12,500 = 3,548, as in the mockup);
  - % change, grouping, and the pace forecast.

  107/107 unit tests pass in total.
- **UI, phone 390×844, real app against an in-memory fake backend:**
  31/31 checks passed, no page errors. The Phase 3 suite was re-run after
  Oyni yopish moved to the shared Daromad: 36/36.
  - Cash 578,700,000.
  - November: profit +519,145,938, 1 kg tannarxi 530, margin 6,939.
  - Composition 75.9% / 20.3% / Kategoriyasiz.
  - Zahira 20,000,000, yetarli.
  - Forecast for Dekabr.
  - Chart: all tabs work, and hovering a column switches the readout.
  - Picker: switching to October updates the URL, and October is on cash
    basis (+16,200,000).
  - Category drill-down: +2% / ↑ 600k / 75.9%; pending entries excluded;
    Excel file downloads.
  - The uncategorized drill-down works.
  - Oyni yopish shows the same October Daromad.
  - Rahbar: the read-only overview has no "+ Qo'shish", category pages sit
    under `/rahbar`, and Tarix is reachable.
- **Checks:** build passes, oxlint is clean (only pre-existing warnings),
  and the RPC wrapper check is OK.

## Rates for Aug–Oct 2026 (migration 0168, applied live)

The owner asked (2026-11-23) for August, September and October 2026 to use
the November rates: moyka 7,468.75 and rezka 4,133.93 so'm/kg. Added via
admin SQL, like November; `set_by` is "Abdulloh (via admin, 2026-11-23)".
Those months' Daromad now follows the accrual definition (kg × rate), no
longer the cash fallback.
