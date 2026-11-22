# 0250 — Buxgalteriya Phase 2: input screens + recurring auto-post

2026-11-22 — Follows 0249 (Phase 1). Five input screens and the recurring
expense job, built against the mockup artboards Main, CashIn, BalanceTopUp,
Recurring and History, using the app's own components (decision 0249).

## Screens (`/buxgalter/kirim/*`)

- **Xarajat** (index):
  - Four sections, as in the mockup: summa / to'lov sanasi / qaysi oy uchun;
    qabul qiluvchi + kategoriya; xarajat turi; qaysi hisobdan; izoh + chek.
  - Qabul qiluvchi and kategoriya are **combo fields with inline
    "+ … qo'shish"**. The receiver hint reads "Oxirgi: Okt'26 · 2.21M so'm".
  - The receipt goes to `buxgalteriya-files/expenses/…`; images are
    compressed like every photo in the app.
  - Aside: Ko'rib chiqish; Saqlagandan keyin (source balance and utility
    cover, before → after, with a warning under 1 month or a negative
    balance); Shu oyda — <kategoriya> with the 6-month average.
  - **Pending auto-posts banner**: Tasdiqlash opens the entry in the form;
    the amount can be corrected; status becomes `confirmed`.
  - **So'nggi xarajatlar** list with Tahrirlash (edit in place) and Bekor
    qilish (void, reason required). Both write `audit_log`, and neither is
    offered for a closed period.
- **Tushum**:
  - Global Export is fixed.
  - **Xizmat turi** is Moyka / Rezka / Boshqa (owner: Rezka income can be
    recorded too).
  - The default period is the previous month (Global Export pays a month in
    arrears).
  - **Expected = Moyka output kg × that month's moyka rate.** The kg come
    from the existing Hisobot engine (`report_totals`, MOYKADAN, owner =
    Global Export), not a new calculation. "Kutilgan summani qo'yish" fills
    the amount. A month with no rate says "belgilanmagan".
  - Aside: expected vs received per month as plain numbers. No receivables,
    no paid/unpaid badges (brief invariant 5); the mockup's "qarzdorlik"
    lines are deliberately not built.
  - Recent list with void.
- **Balans to'ldirish**:
  - Destination: kassa or a utility, with **+ Yangi balans** to create a
    utility account inline.
  - Source: any other account, default bank.
  - Amount chips +1M / +5M / +10M / Oylik taxmin; after-transfer aside;
    recent list with void.
- **Doimiy xarajatlar**:
  - Totals: oylik jami, faol, keyingi 7 kun.
  - Table: next due date, Faol / Yaqin / Nofaol.
  - Create / edit form with the same combos; To'xtatish / Faollashtirish
    (audited).
- **Tarix**:
  - Period, kind, category and account filters; totals; Excel export.
  - Expenses and cash-ins filter by `period_month`; transfers by date.
  - Read-only copies are mounted at `/rahbar/moliya/tarix` and
    `/menejer/moliya/tarix`, linked from the Moliya page (proposal 12).

Edit is implemented for expenses (the main flow). Cash-ins and transfers are
corrected by void + re-entry; there's no in-place edit yet.

## Recurring auto-post (migration 0166, applied live)

`post_due_recurring_expenses(p_today)` (security definer, not executable by
app roles) creates one **pending** expense per active schedule once its day
(clamped to the month length) has arrived in Tashkent. It:
- never posts for a due date before the schedule existed;
- never posts twice for the same schedule and month, and doesn't re-post if
  the accountant voided that month's entry ("skip");
- never posts into a closed period.

`pg_cron` is enabled; job `buxgalteriya-recurring-autopost` runs at
`5 0 * * *` (05:05 Tashkent).

## Data layer

- `src/lib/useFinance.ts`: React Query reads under the `fin` key prefix,
  with one `invalidateFinance()` after every write. Writes go through
  `run()`; RLS "0 rows" is turned into an error; `audit_log` is written on
  edit, confirm and void.
- `financeFormat.ts`: pure helpers, 6 tests.
- `avgMonthlySpendByAccount` in `financeBalances.ts`: 1 more test.
- `useFinanceAccounts` gives balances plus average spend (for "~2.3 oy").
- Components: `components/finance/ComboField.tsx`, `FinanceInputs.tsx`.

## Verification

- **Job, live DB, rolled back:**
  - 22 Nov posts only the day-1 schedule; a schedule created on the 22nd
    waits for 1 Dec;
  - a re-run is a no-op;
  - 30 Nov posts day 25 and day 31→30;
  - a voided entry isn't re-posted;
  - an inactive schedule is never posted; a closed January posts nothing;
  - the cron job is registered; `authenticated` can't execute the function.
- **Write paths as Muborak, live DB, rolled back:**
  - sees and confirms a pending auto-post with a corrected amount, and the
    audit row is written;
  - Rezka cash-in plus void;
  - creates a new utility balance;
  - creates, edits and pauses a schedule;
  - cannot call the job.
- **UI, phone viewport 390×844, real app against an in-memory fake
  backend:** 40/40 checks passed.
  - Balans: transfer and chips.
  - Xarajat: create with inline receiver and category, review and after
    balance, list, edit (+audit), void with reason (+audit), pending
    confirm (+audit).
  - Tushum: fixed customer, previous-month default, "belgilanmagan" for
    October, November expected 74,530 × 7,468.75 = 556,645,938, saved, no
    "qarzdorlik" anywhere.
  - Doimiy: create, next due "1 Dek", edit (+audit), pause.
  - Tarix: correct rows, voided and other-period rows excluded, filter.
  - Rahbar: read-only Tarix works and the input screens are refused.
  - No page errors.
- Build passes, 101/101 unit tests pass, lint and the RPC check are clean.
