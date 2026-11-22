# 0249 — Buxgalteriya (accounting), Phase 1: schema, RLS, role, routes

2026-11-22 — Start of the accounting module: Buxgalteriya (input, accountant
"Muborak") and Moliyaviy ko'rsatkichlar (read-only output). Brief from the
owner, design canvas "BATU Buxgalter — kirim va ko'rsatkichlar"; all nine
artboards were read before any code.

## Decisions taken with the owner (2026-11-22)

- **Owner role = `rahbar`.** The brief said "egasi". In this app "Egasi"
  means the client (SPEC §2.10), so the brief's "egasi" maps to `rahbar`.
  New role: **`buxgalter`** (migration 0164).
- **Monthly rates are set by the owner through Claude (admin SQL).** There is
  no rate-entry UI and `monthly_rates` has no write policy, so Rahbar stays
  read-only (SPEC §2.12). Rates carry kopeks, so they're `numeric(12,2)`, one
  per (month, service). Seeded for Nov 2026: moyka **7,468.75**, rezka
  **4,133.93**.
- **Categories start empty.** The accountant creates them inline from the
  combo field. `group` is optional.
- **Uncategorized expenses are allowed** (`category_id` nullable). The
  "kategoriyasiz" check stays in Oyni yopish (Phase 3).
- **Expected earnings = Moyka output kg × moyka rate.** Cash-ins can still
  be tagged `moyka` / `rezka` / `other`.
- **Rezka is cut from Oyni yopish gating.** It gets connected to finance
  once the Rezka operation is ready.
- **Proposals accepted (no objection):**
  - Build with the app's own components and `AppNavShell`, keeping the
    mockups' layout and labels but not their dark-only palette.
  - No receivables wording in the cash-in screen; expected and received are
    shown as plain numbers.
  - Void, never delete. Edits allowed only while a period is open; a closed
    period is frozen by the database.
  - Recurring and Kutilayotgan auto-posts land as `status = 'pending'` and
    the accountant confirms them, correcting the amount if needed. Only
    `confirmed` rows count.
  - The Global Export cash-in gate passes with any cash-in for the period.
  - Rahbar sees Moliya (plus a read-only Tarix later), not the input forms.
  - The "Prognozni sozlash" link is omitted.

## Deviations from the brief (repo conventions win)

- **Routes follow the repo's one-tree-per-role pattern.** The role home is
  `/buxgalter`; inputs are under `/buxgalter/kirim/*`; Moliya is mounted as
  `/buxgalter/moliya`, `/rahbar/moliya` and `/menejer/moliya`, the same way
  `HisobotTab` is shared. The brief's `/buxgalteriya/*` and `/moliya/*` would
  have needed a second routing scheme.
- **`receipt_path`, not `receipt_url`.** It stores the object key in the new
  private bucket `buxgalteriya-files`, the house pattern for every photo
  column.
- **`voided_at` / `voided_by` / `void_reason`, not `deleted_at`.** That's the
  house "never DELETE — void" rule.
- **Period closing is append-only.** `period_close_events` (close/reopen) is
  the audit trail; the `period_status` view gives the latest state per month;
  a reopen requires a non-empty reason (CHECK).

## Schema (0165)

Tables:
- `accounts`, `expense_categories`, `counterparties`
- `recurring_expenses`, `upcoming_obligations`
- `expenses`, `cash_ins`, `transfers`
- `period_close_events`, `monthly_rates`

View `period_status`.

Functions:
- `is_finance_reader()`: buxgalter, rahbar or menejer.
- `is_buxgalter()`.
- `period_is_closed()`.
- Triggers that freeze a closed period's `expenses` and `cash_ins` (insert,
  update, void, or moving a row out). Transfers have no period, so they
  aren't frozen.

RLS: the three roles above can read; buxgalter can insert and update; there's
no DELETE policy anywhere. Seed: the 4 accounts, the "Global Export" customer
(linked to `owners`) and the Nov 2026 rates.

## Frontend

- `UserRole` gains `buxgalter`.
- `BuxgalterLayout` (AppNavShell, two destinations) and
  `BuxgalteriyaTabsLayout`: seven tabs, each a placeholder naming its phase.
- `MoliyaHome` shows live account balances.
- `financeBalances.ts`: a pure, date-based balance calculator with 5 unit
  tests. `useAccountBalances` wraps it in React Query.
- The `admin-users` function and the Foydalanuvchilar page accept
  `buxgalter`.

## Verification

- **Schema:** live DB, in a rolled-back transaction, 19/19 checks passed:
  - seed rows;
  - Rahbar and Menejer can read but not write;
  - Ombor and Client read 0 rows;
  - a closed month rejects inserts and voids, a reopen needs a reason, and a
    reopened month accepts writes again;
  - `period_month` must be the first of the month;
  - the bucket is private.

  Buxgalter writes could not be exercised there, because a new enum value
  can't be used in the transaction that adds it. That's planned right after
  0164 is applied.
- **UI:** phone viewport, mocked backend, 20/20 checks passed:
  - redirect and the seven tabs;
  - Moliya balances computed correctly (bank 30,595,200, kassa 13,800,000);
  - Moliya and its menu item work for Rahbar and Menejer;
  - Rahbar is refused the input routes, and Ombor is refused Moliya.
- Build passes; 94/94 unit tests pass.
