# 0251 — Buxgalteriya Phase 3: Kutilayotgan, Oyni yopish, Davr tarixi

2026-11-22. Follows 0250 (Phase 2). Built against the mockup artboards
Kutilayotgan and OyniYopish, using the app's own components (0249).

## Migration 0167 (applied live)

- **`post_due_obligations(p_today)`**, security definer, not executable by
  app roles.
  - Once an obligation's due date arrives in Tashkent, it posts **one
    pending expense** for it (`upcoming_obligation_id` set; the note is the
    obligation's name).
  - The source account falls back to the bank account.
  - It never posts twice, never re-posts a voided entry, and never posts
    into a closed period.
- **Daily job:** the cron job `buxgalteriya-recurring-autopost` (05:05
  Tashkent) now calls `buxgalteriya_daily()`, which runs both the recurring
  job and the obligations job.
- **Obligation lifecycle (triggers):**
  - Confirming the auto-posted expense marks the obligation `paid`.
  - Voiding it marks the obligation `skipped`. Without this, the obligation
    would sit pending forever, because the job never re-posts.
  - When a monthly, quarterly or yearly obligation leaves `pending` (paid,
    or skipped from the screen), the next occurrence is created with the
    due date and period moved on.
  - Known limit: due dates step with Postgres `+ interval`, so 31 Jan →
    28 Feb → 28 Mar. The accountant can edit the date if it matters.
- **`period_close_blockers(month)`** is the single source of truth for
  the checklist. The screen calls it, and a `before insert` trigger on
  `period_close_events` re-runs it. The trigger also refuses:
  - closing the current or a future month (Tashkent time);
  - closing a month that is already closed;
  - reopening a month that isn't closed.

  The checks, per brief invariant 3, without Rezka (cut by the owner):

  | Code | Meaning | Blocks close |
  |---|---|---|
  | `recurring_missing` | active schedules due in the month with no entry (a voided one counts as a deliberate skip) | yes |
  | `pending` | auto-posts not yet confirmed | yes |
  | `cash_in_missing` | no Global Export cash-in for the month (any amount passes, proposal 9) | yes |
  | `uncategorized` | confirmed expenses with no category | yes |
  | `obligations_open` | obligations for that period still pending | **no**, shown only |

- **`audit_log`:** new policy `finance_audit_read`. Buxgalter, Rahbar and
  Menejer can read finance-table rows. Every other table stays Rahbar-only,
  as before.

## Screens

- **Kutilayotgan** (`/buxgalter/kirim/kutilayotgan`):
  - Form, as in the mockup: nomi, kategoriya combo, taxminiy summa; to'lov
    muddati with "N kun qoldi"; qaysi davr uchun (defaults to the due
    date's month until changed); takror pills; qaysi hisobdan taxmin
    (default bank); oldindan eslatish; izoh.
  - List sorted by due date: "~amount", "category · recurrence · account",
    "date · N kun qoldi", and "X so'm/kun ajrating" (amount ÷ days left, to
    the nearest 1,000, matching the mockup's 833,000).
  - A card is highlighted once inside its reminder window.
  - Once posted, the card shows "Xarajatda tasdiqlash kutilmoqda".
  - "Taxminni yangilash" edits the obligation and writes an audit entry.
- **Oyni yopish** (`/buxgalter/kirim/oyni-yopish`):
  - **Open periods:** every month from the first one with any finance entry
    up to last month, plus any reopened month.
    - Provisional Daromad, Xarajat, Sof foyda, and 1 kg tannarxi
      (confirmed expenses ÷ Moyka output kg, from the same `report_totals`
      engine Tushum uses).
    - A "⚠ … ~X ga oshadi" line for missing and unconfirmed amounts.
    - The checklist, with a link to the right tab for each issue.
    - The close button is disabled while anything blocks.
  - **Current month:** "Yopishga hali erta — odatda 5-7 <next month>'da".
  - **Closed periods:** date · who closed it, the three figures,
    Qayta ochish (needs a reason) and Davr tarixi.
  - A reopened month goes back to the open list, marked "Qayta ochilgan —
    vaqtincha".
- **Davr tarixi** modal, opened from Oyni yopish and from Tarix (including
  the read-only Rahbar and Menejer copies):
  - the close and reopen events, with reasons;
  - edits, confirms, voids and skips of that period's expenses, cash-ins
    and obligations, with the amount change and the actor's name;
  - newest first, as the log stores it.
- **Xarajat:** the pending banner shows an obligation's name, because
  obligation auto-posts have no receiver.
- The Phase 1 placeholder page is removed; nothing uses it now.

## Deviations from the mockup (flagged for the owner)

- **"Keyinga" (postpone) on checklist items isn't built.** It would let a
  month close with a known gap, which contradicts the gating invariant.
  "Kiritish" links to the right tab instead.
- **"Yopilish muddati taxminan 25 Noyabr"** on open past months isn't built.
  Nothing in the data defines that date. The current month shows the
  mockup's "odatda 5-7 …" line.
- **"O'tkazib yuborish" (skip) on Kutilayotgan is an addition.** Without it,
  an obligation that won't be paid could never leave the list (no DELETE,
  0249). It requires a reason, which is audited.
- **Rezka checklist row:** cut (owner, 2026-11-22).
- The **Oyni yopish** totals table covers the last 12 months of entries.
  Older closed months would show zeros, but none exist yet; the module
  started in November 2026.

## Verification

- **Live DB, rolled back, as Muborak:**
  - **Obligations job:**
    - posts 1 on 22 Nov, from the bank account, as pending;
    - a re-run posts 0.
  - **Obligation lifecycle:**
    - confirming → `paid`, and the next one is created for 20 Dec / Dec
      pending;
    - voiding a one-off's auto-post → `skipped`, with no roll-forward;
    - skipping a recurring one creates the next one (20 Jan).
  - **Checklist for Nov:** pending 1, cash_in_missing 1, obligations_open 2.
  - **Close and reopen rules:**
    - closing Nov is refused ("Joriy yoki kelgusi oy…");
    - reopening an open month is refused;
    - closing Oct is refused with `cash_in_missing=1`;
    - after a cash-in, the Oct close succeeds, and a second close is
      refused;
    - a blank-reason reopen is refused by the CHECK; a reopen with a reason
      gives status `reopened`.
  - **Permissions:**
    - Menejer can't insert a close (RLS);
    - Muborak and Menejer can read `expenses` audit rows but not
      `kirim_orders` ones.
  - The cron job now runs `buxgalteriya_daily()`.
- **UI, phone 390×844, real app against an in-memory fake backend:** 36/36
  checks passed, no page errors.
- Build passes, 102/102 unit tests pass, oxlint is clean (only
  pre-existing warnings), and the RPC wrapper check is OK.
