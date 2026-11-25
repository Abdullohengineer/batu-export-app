# 0254 — Import of Aug–Oct 2026 finance history; external accounts

2026-11-25. The owner filled in the import template
(`BATU-moliya-import-Avg-Okt-2026.xlsx`) with every bank movement from 1 Aug
to 25 Nov 2026, plus month-end balances. Goal: the app's balances equal the
real ones.

## Reconciliation, before writing anything

The file's bank movements were applied by payment date, starting from the
31.07 balance and compared with each statement balance. Results:

| Period | Difference |
|---|---|
| August | 0.43 so'm |
| September | 0.77 so'm |
| October | −0.07 so'm |
| 1–25 November | 1,032,205 so'm |

The first three are tiyin rounding in the source. The November gap is
exactly the KAPITAL BANK fee dated 30.11, which the bank had already charged.

## Owner decisions (2026-11-25)

- **Tushum counts for the previous month** (Global Export pays in arrears).
  The exception is 13.08, which counts for August, because production
  started in August.
- **MED TORG** payments in October (239,267,830) are **real expenses**.
- **Gaz and elektr** use the top-up + monthly usage model:
  - each bank payment to Hududgaz or Hududiy Elektr Tarmoqlari is a
    **transfer** bank → Gaz/Elektr balansi;
  - each month's **usage** is an expense from the utility account, worked
    out from the month-end supplier balances:
    opening + top-ups − closing.
  - November covers 1–25 Nov, dated 25.11.
- **The bank fee dated 30.11 is dated 25.11**, since it was already charged.
- **Void the 460 so'm test expense** (Parkent TET, 23.11).
- **Rows with an empty "qaysi oy uchun"** in Xarajatlar belong to July
  (owner). They are imported with `period_month` = July 2026, so the bank
  balance stays exact while August and later are untouched. They are noted
  "Iyul (ishlab chiqarishdan oldin)".

## Migration 0169 (applied live)

- **Account kind `external`**, for money that is neither income nor
  expense. Two inactive accounts were created:
  - "Boshlang'ich qoldiq" holds the opening balances (31.07: bank
    1,272,416; gaz 117,018,344; elektr 19,845,375);
  - "Tashqi harakatlar (foydaga kirmaydi)" covers loan repayments received,
    the secondary bank account, and similar.

  Movements to and from these accounts are **transfers**, so they never
  touch sof foyda. Inactive accounts are hidden from every list and picker,
  and the balance math still counts their transfers.
- **`import_batch`** column on `expenses`, `cash_ins` and `transfers`. This
  import is `import-2026-11-25`; to undo it, void everything with that tag.

## Imported (`import_batch = 'import-2026-11-25'`)

- **93 expenses:**
  - 85 from the file;
  - plus 8 monthly gaz and elektr usage entries, which replace the 9
    utility payment rows (those became transfers);
  - plus the 30,000 "пополнение вторичного счета", which became a transfer.

  The file's 95 rows break down as 85 expenses, 9 utility top-ups and 1
  secondary-account transfer.
- **8 tushum.** The file's payer "GLOBAL EXPORT COMPANY" MCHJ is mapped to
  the existing Global Export customer and kept in the note.
- **19 transfers:** 3 opening balances, 9 utility top-ups, 6 "Boshqa
  harakatlar", and 1 to the secondary account.
- **New names:** 22 categories and 30 receivers, created only where
  missing. Names were cleaned of stray spaces, and matching ignores case.
- **Amounts** are rounded to whole so'm, since the app stores so'm.

## Verification (live, after commit)

| Account | 31.07 | 31.08 | 30.09 | 31.10 | 25.11 |
|---|---|---|---|---|---|
| Bank | 1,272,416 | 993,403 | 2,727,568 | 451,367 | 8,479,103 |
| Statement | 1,272,415.77 | 993,403.07 | 2,727,567.39 | 451,367.46 | 8,479,103.51 |
| Gaz | 117,018,344 | 115,888,344 | 112,044,344 | 112,746,344 | 110,798,344 |
| Elektr | 19,845,375 | 5,886,623 | 279,542 | 26,653,277 | 34,992,958 |

- The bank is within 1 so'm of the statement everywhere (tiyin rounding).
- Gaz and elektr equal the rounded supplier balances exactly.
- Kassa is 0; no kassa data was given.
- No imported row lacks a category, receiver or customer.

**P&L by period (tushum / xarajat):**

| Period | Tushum | Xarajat |
|---|---|---|
| July | — | 125,930,977 |
| August | 781,860,000 | 424,434,178 |
| September | 800,000,000 | 845,011,960 |
| October | 850,000,000 | 1,081,393,313 |
| November so far | — | 25,939,870 |

## Code

`useAccountBalances` now also returns `names` for every account, inactive
ones included. Tarix and CategoryDetail use it, so a transfer from
"Boshlang'ich qoldiq" or "Tashqi harakatlar" shows its name instead of "—".
Lists and pickers still show active accounts only.

## Flagged, not changed

- **Same-day equal amounts:** tushum 149,860,000 (09.09) matches the
  expense to "CLIMA VENT SYSTEM" the same day, and tushum 132,000,000
  (10.09) matches the expense to "ECOBUILDING". Both are imported as
  entered, as income and expense. If they were pass-through payments, they
  inflate both sides equally, and profit is unaffected.
- **July** now has expenses but no tushum. Oyni yopish's "Global Export
  tushumi" check would block closing July. July is pre-production and
  doesn't need closing.
