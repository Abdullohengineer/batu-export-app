# Hisobot row/column model correction — revert 97f5444, fix the strip instead

## What changed

Commit `97f5444` ("Range-scope Hisobot moyka flow columns (shared RPC,
affects Приход too)") range-scoped `moykaga_yuborilgan`/`moykadan_chiqgan`/
`k1`–`k8`/`kn`/`yoqotish` in `report_query_page` and `report_totals`, using
two new helper functions (`kirim_line_moyka_range`,
`kirim_line_calibre_output_range`). That solved the wrong half of the
problem: it changed the ROWS (every table cell, both in Hisobot and in the
client-portal Приход screen that shares the same RPCs), when the actual bug
was in the STRIP.

This entry reverts `97f5444` in full (`git revert`, commit `145fab4`, plus
the matching DB-side `DROP FUNCTION`/`CREATE FUNCTION` on
`report_query_page`/`report_totals` — archived at
`docs/data-corrections/2026-09-14_hisobot-moyka-flow-revert-97f5444.sql`)
and replaces it with a narrower, correct fix:

- **Rows/columns**: back to LIFETIME, exactly as they were before
  `97f5444` — every serial's flow/kalibr/loss figures are its full
  standing totals (`kirim_line_state`/`kirim_line_calibre_output`, no date
  args), same value repeated on every row that serial owns, unaffected by
  the active date filter. This is the operator's intended model: the
  direction filter decides which serials appear as rows; the columns
  always show that serial's full lifetime figures. Confirmed live against
  two cross-month serials (110826-003, 180826-001) — an August-only KIRIM
  report's table cells for `moykaga_yuborilgan`/`moykadan_chiqgan`/`k1`/`kn`
  match calling `kirim_line_state`/`kirim_line_calibre_output` directly,
  with no date filter, exactly.
- **Strip**: `TotalsStrip.tsx`'s `STATE_COLUMN_CHIPS` and
  `ClientPrihodTab.tsx`'s `ClientTotalsStrip` `stateChips` both drop the
  chips for `moykaga_yuborilgan`, `moykadan_chiqgan`, `yoqotish`, `k1`–`k8`,
  and `kn`. The balance columns (`qabul_qilingan`, `omborda_qoldi`,
  `moykada`, `xom_jonatilgan`, `olib_ketilgan`) keep their state chips,
  untouched — they're irreducibly as-of-now regardless of period, so
  nothing about them was ever broken. `src/lib/reportColumns.ts`'s
  `ReportColumnTotalBasis` gains a `'none'` value (a lifetime per-row
  figure with no safe strip aggregate at all) and the removed columns
  switch to it (`'both'` → `'movement'` for the moyka pair, since their
  MOVEMENT chip — "Moykaga yuborilgan (davrda)" / "Moykadan chiqgan
  (davrda)" — was always correct and stays; `'state'` → `'none'` for
  `yoqotish`/`k1`–`k8`/`kn`, which had no movement counterpart to fall
  back to, so they now contribute no strip chip at all).
- Приход's own `(сейчас)`-labelled mirror chips for the same 11 fields are
  removed identically — "сейчас" was the wrong word regardless of the
  double-counting bug (these were as-of-now figures mislabelled as
  period-scoped), so there was no version of this chip worth keeping.

## Why (the bug, restated precisely)

A "state" strip chip sums a value once per **distinct serial in the
filtered row set**. That's correct exactly when a serial can appear in at
most one period's filtered set — true for the five balance columns above
(they're as-of-now by definition, so "distinct serial in this period" and
"distinct serial ever" coincide for the purpose the chip serves) and true
for `kirim`-only reports generally (a serial has exactly one arrival, full
stop). It is **not** true for moyka/kalibr flow: `moyka_output`/`chiqim`
events recur, so one serial's activity routinely spans several months.
Summing a LIFETIME figure once per distinct serial then means: run the
report for August, get serial X's full lifetime `moykadan_chiqgan`; run it
again for September, and if X still has an active row that month, its full
lifetime figure gets counted a second time. Stack the two chips and you
double-count every serial that crosses the boundary. `97f5444` tried to fix
this by clipping the underlying COLUMN to the date range instead of fixing
the chip's aggregation — which broke the columns (no longer lifetime, no
longer what any consumer of the row data expected) without actually fixing
the chip's arithmetic (see rejected alternative, below).

## What was learned

**The strip and the rows answer different questions, and conflating them
is what produced `97f5444`.** A row/column tells you "what is true of this
serial" — legitimately lifetime, legitimately as-of-now, legitimately
whatever the underlying business fact is. A strip chip tells you "what is
true of this **filtered set**, added up" — and addition is not a neutral
operation. It only produces a meaningful number when the thing being added
is **additive across the periods a user might stack**: run the same report
for Jan, Feb, and Mar, add the three chip values together, and the result
must equal running the report once for the full Q1 range. Movement chips
(row's own kg, summed across rows) pass this test by construction — every
physical event is counted exactly once, in the one period its date falls
in. A state chip built on a LIFETIME column fails it precisely when the
same serial can recur as a row across periods, which is exactly the
`moyka_output`/`chiqim` situation.

**This is the rule that would have caught `97f5444` before it shipped**:
before adding or keeping any strip chip, ask whether summing it across
stacked periods reproduces the single-range total. If the answer depends on
whether a serial happens to cross the boundary, the chip is wrong,
regardless of whether the underlying column is lifetime or range-scoped —
the column was never the problem; only the aggregation was. This is the
rule to apply to the still-pending Chiqim regrain work and to any future
range-scoped Yo'qotish design: whatever numbers those change, check the
stacking identity before adding a chip for them, not after.

**A range-scoped state chip (the alternative evaluated and rejected before
this revert) does not fix the additivity problem — it just relabels the
same collision.** Mathematically: under any direction filter where
`kirim_line_moyka_range`/`kirim_line_calibre_output_range` are well-defined
(the filter's date range and the range passed to the helper are the same
range), the range-scoped state sum and the movement sum over the same
filtered set sum the *identical* underlying rows — one grouped by row, the
other grouped by distinct serial with a `sum(range-scoped-column)` that
degenerates to the same per-row total once a serial owns only one row in
range (the common case) or legitimately sums to the same total when it
owns several (each row's own qty is what the range function is summing
under the hood). So a range-scoped state chip is at best a redundant
second number identical to the movement chip already on the strip. Under a
KIRIM-only filter it's worse than redundant — coincidentally meaningless,
since a KIRIM date range and a moyka-activity date range have no logical
relationship; the range-scoped figure would just be "how much moyka
activity happened to fall inside an unrelated arrival window." No chip is
the only option that is both correct under every filter and isn't just a
second name for a number already shown.

## `kirim_line_moyka_range` / `kirim_line_calibre_output_range` — kept, deliberately unused

Both functions created by `97f5444` are **left in the database**, not
dropped by this revert. Nothing calls them as of this change. This is
intentional, not an oversight — they are the reusable range-scoped
building blocks needed by the still-pending, separately-scoped range-scoped
Yo'qotish work (and any future Chiqim-regrain work that turns out to need
the same shape). **A future cleanup pass must not delete them as dead
code** on the assumption that "unused" means "leftover" — flagging this
explicitly here so that assumption doesn't get made without checking this
entry first.

## Verification

- `npx tsc --noEmit` — clean, no type errors.
- Live SQL, full year, no filter — reconciliation identity holds exactly as
  before (`state_qabul_qilingan` = `state_omborda_qoldi` +
  `state_moykaga_yuborilgan` + `state_xom_jonatilgan`, diff = 0).
- Live SQL, `report_query_page` spot-check for 110826-003 and 180826-001
  under an August-only KIRIM/Global filter — `state_moykaga_yuborilgan`,
  `state_moykadan_chiqgan`, `state_k1`, `state_kn` all match calling
  `kirim_line_state`/`kirim_line_calibre_output` directly with no date
  filter, confirming the columns are genuinely lifetime again, not just
  coincidentally so for these two serials.
- Confirmed the strip's fix is "chip simply absent" rather than
  "chip present but reduced" — `TotalsStrip.tsx`'s `stateColumns` filter
  (`totalBasis === 'state' || totalBasis === 'both'`) and
  `ClientTotalsStrip`'s hand-built `stateChips` array both now exclude all
  11 affected keys entirely, so there is nothing left on the strip that
  could still be summed across stacked periods incorrectly for those
  fields — the double-counting bug has no surviving code path, not a
  patched one.

## Related

- `docs/decisions/0179-...` through `0183-...` — the P8/P9/finished_pallets
  data-correction sequence this session also covered (unrelated to this
  entry beyond chronology).
- The now-superseded `97f5444` and its own decision entry
  (`0184-2026-09-14-hisobot-moyka-flow-range-scoping.md`) were deleted by
  the `git revert`; this file reuses number `0184` since the revert freed
  it.
