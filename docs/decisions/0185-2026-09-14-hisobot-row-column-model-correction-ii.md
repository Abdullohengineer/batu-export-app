# Hisobot row/column model correction II — re-apply 97f5444, 0184 was wrong

## What changed

`docs/decisions/0184` reverted commit `97f5444` ("Range-scope Hisobot moyka
flow columns") on the grounds that the columns should show lifetime
figures and only the totals strip was broken. **That reasoning was wrong.**
This entry reverts `0184`'s row/column change — `97f5444`'s row/column
model was correct all along — while keeping the one piece of `0184` that
was independently correct (see "What stays from 0184" below).

The corrected rule, stated plainly:

> **The selected date range governs both row selection and column values,
> for every direction.** KIRIM + September → rows are September arrivals,
> every column shows September figures. MOYKADAN + September → rows are
> serials with September output, every column shows September figures (a
> serial reads its September output, not its lifetime total). No column
> shows a lifetime figure under a date filter, with one deliberate
> exception (below).

Applied: `moykaga_yuborilgan`, `moykadan_chiqgan`, `k1`–`k8`, `kn` are
range-scoped again — table cells (Hisobot and Приход, same shared RPCs) and
the K1–KN strip chip. Two new lifetime-twin columns
(`moykaga_yuborilgan_jami`/`moykadan_chiqgan_jami`, default-hidden) preserve
the two identities that depend on lifetime figures. The moyka pair's own
strip chip stays a movement-only chip (see "Strip chips," below — this
deviates from `97f5444`'s own literal design, deliberately).

## Why `0184` got it wrong

The operator's original ask was that the columns "should be able to see
their incoming number." That was read as a request for a **lifetime**
figure — "the total amount this serial has ever sent to Moyka." It meant
the **incoming figure for that reporting period** — "how much this serial
sent to Moyka in the month I'm looking at." Those are different questions,
and `0184` answered the wrong one: it treated `97f5444`'s range-scoping of
the columns as the bug, when the columns were the fix and the double
counting it also (correctly) diagnosed lived entirely in the strip's
aggregation, not in what the columns displayed.

The tell, in hindsight: `0184`'s own reasoning required proving a
range-scoped STRIP CHIP collides with the movement chip — true, and a real
finding — but that finding is about how the strip sums a column, not about
what the column itself should show. Reverting the column to fix a strip
problem conflated two different layers that `0184`'s own "the strip and
the rows answer different questions" framing (written in that same entry)
should have kept separate. This is the general lesson worth restating for
whoever reads this next: **a bug in how a total is aggregated is not
evidence that the underlying per-row/per-column value is wrong** — check
which layer actually produced the wrong number before deciding which layer
to fix.

## The balance-column exception

`Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan` and
`Moykaga yuborilgan = Moykadan chiqgan + Moykada + Yo'qotish` are both
inherently LIFETIME statements — "everything ever received now sits in one
of these buckets." Range-scoping `Moykaga yuborilgan`/`Moykadan chiqgan`
breaks both identities under any date filter narrower than full history,
with no date-filter choice that fixes it (an as-of-now balance has no
period meaning to align against).

Balance columns (`qabul_qilingan`/`omborda_qoldi`/`moykada`/
`xom_jonatilgan`/`olib_ketilgan`) are therefore the one deliberate
exception to the rule above — genuinely timeless, never range-scoped.
Fixed by restoring `97f5444`'s design: two lifetime-twin columns,
`moykaga_yuborilgan_jami`/`moykadan_chiqgan_jami`, sourced from the
unchanged `kirim_line_state`, default-hidden like every other
reconciliation-only column in this family, with a `headerNote` tooltip on
the plain (now range-scoped) columns pointing at them. Rejected: hiding
the balance columns under a date filter (breaks the "visibility is
picker-driven, not filter-driven" precedent this whole column family
relies on) and dropping the identity entirely (makes a previously-checkable
invariant permanently unverifiable). Verified live: full year, no filter,
`state_qabul_qilingan = 195,618`, `identity_rhs = 195,618`, `diff = 0`.

Приход (`ClientPrihodTab.tsx`) does **not** get the twin columns — explicit
operator call: it has no column picker (fixed 27-column list), the
identity is an internal reconciliation tool, and clients have no need to
verify it. Left at 27 columns.

## Strip chips — deviates from `97f5444`'s own design

`97f5444` kept both a movement chip AND a range-scoped state chip for the
moyka pair (relabelled to disambiguate). Re-verified live before
re-applying: under any filter that includes moyka rows, the two are
numerically **identical** (confirmed: September/Global/no-direction-filter
→ both read 46,958 in / 46,000 out). Under a KIRIM-only filter the movement
chip correctly reads 0 (no moyka row is in a kirim-filtered set) while the
state chip would show a real but **coincidental, meaningless** number
(confirmed: KIRIM-only/September/Global → movement 0, naive range-scoped
state chip 8,292 — moyka activity from serials that merely happened to
arrive that month). Showing both is therefore either redundant or actively
misleading, never informative — so this re-apply keeps the moyka pair's own
state chip OUT (movement chip only), rather than restoring `97f5444`'s
"keep both, relabel" approach.

`k1`–`k8`/`kn` have no movement-chip counterpart to collide with (kalibr
output is not a `report_rows` `kind`), so their state chip is a genuinely
new, non-duplicate, now-additive number — restored, matching `97f5444`'s
original (`0184` had removed it along with everything else).

Coherence check (explicitly requested before finalizing): assembled the
strip under MOYKADAN + September live. `Moykadan chiqgan (davrda):
46,000 kg` is the one clear output-total chip; K1–KN (once enabled via the
picker) gives the per-kalibr breakdown — one chip per metric, no gaps, no
duplicates. Noted separately, not fixed (pre-existing, unrelated to this
change): `Kirim`/`Chiqim`/`Neto`/`Moykaga yuborilgan (davrda)` all read 0
under this same filter, because the movement-chip group has always been
column-visibility-driven rather than direction-relevant-driven (since
2026-08-15) — a first-time reader of a MOYKADAN-only report sees four
zero-value chips above the one real number. Flagging it per instruction to
say so rather than ship past it silently; out of scope to fix here.

## What stays from `0184`

`0184`'s removal of Yo'qotish's strip chip was **not** part of the mistake
and is not reverted. Yo'qotish was never range-scoped by `97f5444` (`97f5444`
explicitly deferred it — "a later task," still true here) and its column
still sources from `kirim_line_state`/`client_serial_loss_kg`, still
lifetime. The double-counting risk `0184` identified for it is real and
unchanged by this entry — its chip stays removed (`totalBasis: 'none'`).

## Verification

- `npx tsc --noEmit` — clean, all 8 changed files.
- DB migration dry-ran in `BEGIN...ROLLBACK` before applying for real —
  archived at
  `docs/data-corrections/2026-09-14_hisobot-moyka-flow-range-scoping-reapply.sql`.
- Applied live. Qabul qilingan identity: `diff = 0`, full year, no filter.
- `report_query_page`, MOYKADAN direction + September, all 5 known
  cross-month serials — period-scoped and lifetime-twin values both
  correct: 110826-002 reads `period_to_moyka=0, period_from_moyka=70,
  lifetime twins 7,345/7,400, K2=70` — matches the operator's own example
  exactly and matches independent computation via
  `kirim_line_moyka_range`/`kirim_line_calibre_output_range` run directly
  (same session, proposal phase). Additivity re-confirmed for all 11
  metrics across all 5 serials, both months (August + September = lifetime,
  exactly, for every metric).
- Live before/after comparison of the KIRIM-only-vs-full-filter strip-chip
  behavior (see "Strip chips" above) — both cases reproduced with real
  data, not just asserted.

## Related

- `docs/decisions/0184-2026-09-14-hisobot-row-column-model-correction.md` —
  the entry this one corrects. Left in place (not deleted) as the record of
  what was tried and why it was wrong; this entry is the correction, not a
  silent overwrite.
- `kirim_line_moyka_range`/`kirim_line_calibre_output_range` — created by
  `97f5444`, kept live and unused through `0184`'s revert, now back in
  active use by `report_query_page`/`report_totals`.
- The still-pending, separately-scoped range-scoped Yo'qotish work, and the
  Chiqim regrain investigation — both should apply the restated rule from
  this entry (date range governs rows and columns; check which layer
  produced a wrong number before deciding which layer to fix) rather than
  re-deriving it from scratch.
