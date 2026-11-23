# 0253 — Tarix: ✎ Tahrirlash / 🗑 O'chirish per row

2026-11-23, owner request: "if something were to happen, the user can edit
things." Follows 0250 (Tarix) and 0251.

## What

- Each row in the accountant's Tarix (`/buxgalter/kirim/tarix`) has two
  icon buttons: pencil **Tahrirlash** and bin **O'chirish**. The column is
  pinned to the right edge, so it stays visible on a phone even though the
  table scrolls sideways.
- **Tahrirlash** opens a dialog for any kind of row:
  - **Expense:** summa, to'lov sanasi, qaysi oy uchun, qabul qiluvchi and
    kategoriya (combos with inline add), xarajat turi, hisob, izoh. It uses
    `updateExpense`, so a pending auto-post stays pending; confirming still
    happens on Xarajat.
  - **Cash-in:** summa, sana, davr, xizmat turi, hisob, izoh.
  - **Transfer:** summa, sana, from and to account, izoh.

  Cash-ins and transfers go through the new `updateFinanceRow`. **Phase 2
  said they could only be corrected by void and re-entry (0250); that is now
  superseded by in-place edit.** Every edit writes an `audit_log` 'edit'
  row with the before and after values of the changed fields, which shows
  up in Davr tarixi.
- **O'chirish = void, never DELETE** (SPEC §2.15, house rule). It needs a
  reason and uses the existing `voidFinanceRow`.
  - The row leaves every list, balance and report.
  - It stays in the audit trail as 'void' with its reason.
  - Voiding an obligation's auto-post still marks the obligation skipped
    (0251).
- **Closed periods:** their rows show 🔒 instead of the buttons. The
  database refuses edit and void there anyway (`expenses_period_open` /
  `cash_ins_period_open`, checking both the old and the new period).
- **Rahbar and Menejer** copies of Tarix stay read-only: no column, no
  buttons. RLS also gives them 0 rows on update.

No migration: the existing RLS already lets the buxgalter update these
tables.

## Verification

- **Live DB, rolled back, as Muborak:**
  - edited a cash-in's amount, service and period, and a transfer's amount
    and direction (1 row each);
  - wrote the audit row;
  - in a closed month, both edit and void were refused ("Davr yopilgan");
  - as Menejer, the same update hit 0 rows.
- **UI, phone 390×844, real app against a fake backend:** 14/14 checks
  passed, no page errors.
  - Icons appear on all 5 November rows.
  - Expense edited from 8,000,000 to 8,500,000, with the audit entry.
  - Transfer edited from 40M to 35M, with the audit entry.
  - The delete button stays disabled until a reason is typed; the row is
    then voided (no DELETE request is sent), the audit 'void' is written,
    and the row is gone from the list.
  - October cash-in changed from Rezka to Boshqa, with the audit entry.
  - Closed September rows show 🔒.
  - The Rahbar Tarix has no action column.
