# Fix chiqim rollup regressions, add per-kalibr breakdown to dispatch lines

## What changed

Follow-up to `0188` (the Chiqim regrain/rollup). Investigated, then fixed,
two claimed regressions and added one new requirement, all rooted in the
same rollup grouping.

**Investigation findings** (full detail in the session transcript;
summarized here):

- **Regression 1 (full request contents unreachable) — real.**
  `ChiqimDispatchRowDetail.tsx`'s "So'rov tafsilotlarini ko'rish →" button
  — which opens the pre-existing `ChiqimRequestDetail` body (Menejer/Ombor/
  Qorovul actors+times, gate photos, full cargo composition) — was gated
  behind `oldKnKg > 0`, a leftover of the button's original narrower
  purpose (it only existed for old-KN's own drill-down before the
  rollup). Any dispatch without old-KN cargo — the common case, a
  pure-pallet or pure-raw fura load — had no way to reach this at all.
  Nothing was lost in the DB; the component and its data-fetching
  (`useChiqimRequestById`) were already complete and already proven
  working from Menejer's own screen and from this exact modal.
- **Regression 2 (serial passport unreachable) — not reproducible.**
  Traced the full prop chain (`HisobotTab` → `ReportResultsTable` →
  `ReportTableRow`/`ReportRowCard` → `ChiqimDispatchRowDetail`) and the
  underlying query (`useDispatchManifestLines`, embedding `finished_pallets`
  via the live `chiqim_pallet_consumption_barcode2_fkey` FK) — the
  per-pallet passport click was already wired and, as far as static
  tracing can confirm, functional. Not changed. Held per instruction —
  the operator will check live and report back what they actually see
  before any further action here.
- **Requirement 3 (per-kalibr breakdown)** — net new, not previously built.

## Fix 1: full request detail always reachable

`ChiqimDispatchRowDetail.tsx`'s detail button is now unconditional, moved
next to the row's own "Jami" total instead of nested under the old-KN
line. `OldKnRequestPassportModal.tsx` renamed to `ChiqimRequestPassportModal.tsx`
(same body) — it stopped being old-KN-specific the moment every dispatch
line started using it. The rename cascaded mechanically through the prop
that opens it: `onOpenOldKnRequest` → `onOpenChiqimRequest`, `HisobotTab`'s
`oldKnRequestId`/`setOldKnRequestId` state → `chiqimRequestId`/
`setChiqimRequestId`. Stale comment references (`useFinishedChiqimRequests.ts`,
`ChiqimRequestDetail.tsx`) updated to the new name.

## Fix 2: per-kalibr breakdown on dispatch lines

`chiqim_dispatch_calibre_breakdown(p_request_id, p_directions, p_from, p_to,
...same filter params as report_dispatch_rows_v2)` — mirrors
`kirim_line_calibre_output_range`'s exact shape (9-column `k1..kn` table,
`nullif`-computed blank-not-zero) but keyed by `request_id` instead of
`serial`, summing only the pallet (`chiqim`) component kind — raw/old-KN
cargo has no calibre and correctly contributes nothing. Wired into
`report_query_page` as a new `left join lateral ... on f.kind =
'chiqim_dispatch'`, adding 9 trailing columns (`dispatch_k1..dispatch_kn`),
same mechanism as the existing `kirim_line_calibre_output_range` lateral,
just a different key.

**Deliberately separate keys from `k1`-`kn`, not a reuse.** The existing
columns are a *serial's own wash-output composition* (state-basis, summed
once per distinct serial); the new ones are *what one truck carried*
(row-basis, summed per dispatch line). Reusing the same fields/keys would
put two different metrics under one label — the exact pattern already
rejected for `moykaga_yuborilgan`'s own plain column (see `reportColumns.ts`).

**Blank-not-zero at SQL level**, not render level — same reasoning as
every other null-distinction in this report engine: the table and the
Excel export both need to agree, and a render-level heuristic would have
to be reimplemented in both places. Note this is a UI-legibility
convention here, not a genuine ambiguity the way Yo'qotish's open/closed
distinction is — "carried none of that kalibr" and "carried zero kg of
that kalibr" are the same fact for a dispatch; blank just reads cleaner
across a 9-column matrix where most lines only touch 2-3 kalibrs.

**Mixed-cargo caveat, as instructed — surfaced, not reconciled.** A
request combining pallet cargo with raw/old-KN cargo has its
`dispatch_k1..dispatch_kn` sum to *less* than the row's total kg (the
non-pallet portion isn't kalibr-attributable). Confirmed live across all
10 Aug–Sep dispatch lines: the 5 pallet-bearing lines' kalibr sums equal
their full row total exactly (no mixed-cargo case currently exists in live
data to demonstrate the shortfall), and the 5 pure-raw/old-KN lines
correctly show all 9 columns blank. Not forced to reconcile — same
"not silently incomplete, flagged instead" convention the pallet-manifest
table already established (`ChiqimDispatchRowDetail.tsx`'s own comment).

**Strip chips — skipped for v1, per explicit instruction.** Two chips
both labeled "K4" under a combined KIRIM+CHIQIM filter, meaning different
things, is exactly the pattern already rejected once (see
`moykaga_yuborilgan`'s own precedent). `totalBasis: 'none'` on all 9 new
columns — the type's one previously-unused value, now used, so the
decision reads as deliberate rather than an oversight. `report_totals` is
untouched.

## The duplicated-predicate review finding

`report_dispatch_rows_v2`'s `is_match` predicate (from `0188`) would
otherwise have needed a byte-for-byte copy inside the new breakdown
function — flagged during review as a drift risk a comment wouldn't
prevent. Checked whether it factors cleanly: it does. New function
`chiqim_component_is_match(...)` — a pure, `IMMUTABLE` boolean predicate
taking the row's own match-relevant fields plus the filter params — is now
the single definition, called from both `report_dispatch_rows_v2` (body-only
`CREATE OR REPLACE`, same 14-arg signature) and
`chiqim_dispatch_calibre_breakdown`. Verified the refactor changed nothing
observable: August/Sep 1–12/full-year totals and the empty-array `p_kinds`
hardening (`0188`'s own post-hoc fix) all read identically before and
after.

## Date-filtering `useDispatchManifestLines` — investigated, not changed

Raised as a possible related gap (an undated query feeding a dated
report). Checked: `chiqim_departed_at(request_id)` is a per-REQUEST fact,
not per-consumption-row — a request has exactly one departure date. Since
`useDispatchManifestLines` is only ever called already scoped to one
`requestId`, and that dispatch line only renders at all when its one date
is inside `[p_from, p_to]`, every consumption row under that `requestId`
necessarily shares a date already inside the report's range. Date-filtering
this query would be a structural no-op — there is no date dimension to
filter here at all, because `requestId` alone already pins it. Left
unchanged.

The manifest table's real, pre-existing gap is that it isn't filtered by
the report's *other* active filters (calibre/serial/wash_cycle/lab_verdict/
etc.) — already self-flagged via the amber reconciliation-mismatch
warning in `ChiqimDispatchRowDetail.tsx`. Confirmed real, left unfixed:
threading the full filter set through this query is materially bigger
than "cheap while the file is open," and wasn't what was asked.

## Verification

- `npx tsc --noEmit` — clean.
- `npx tsx --test src/lib/reportQuery.test.ts` — 13/13 passing (added 2
  tests for the `chiqim_dispatch` fixture: `dispatchK1`/`dispatchKn`
  default to `null`, and `dispatch_k*` map field-for-field with missing
  ones staying `null`, not coerced to `0`).
- Live SQL (`report_dispatch_rows_v2`, `report_query_page`, `report_totals`
  against project `qohoqbapevrcjqxbstxi`):
  - Reconciliation unchanged post-refactor: August 69,151 kg / Sep 1–12
    exactly 28,970 kg across 2 lines / full year 98,121 kg.
  - Empty-array `p_kinds` still returns 0 rows; `null` still returns all 10.
  - All 10 live Aug–Sep dispatch lines: kalibr-breakdown sum equals the
    pallet-only portion of the row total, exactly — the 5 pallet-bearing
    lines match their full total (no live mixed-cargo case exists to
    demonstrate the caveat), the 5 pure-raw/old-KN lines are all-blank.
  - Blank-vs-zero and cross-filter narrowing spot-checked directly (see
    the archived SQL's own verification footer for the exact numbers).
- 🚩 **UI-level verification not performed this session** — same
  constraint as `0188`/`0186`: no `.env.test` and no working Playwright
  install in this container, so the unconditional detail button, the
  renamed modal, and the new columns' on-screen rendering have not been
  click-tested. The SQL/mapping-level verification above is exhaustive for
  what this environment can actually run.

## Related

- `docs/decisions/0188-2026-09-14-chiqim-regrain-departure-date-dispatch-rollup.md`
  — the rollup this entry fixes regressions in, and the origin of the
  `is_match` predicate this entry factors out.
- `docs/decisions/0186-2026-09-14-moykada-yoqotish-period-scoping.md` —
  origin of the "correct only because the data happens not to overlap is
  not acceptable" principle `0188`'s own hardening fix (and this entry's
  predicate-sharing decision) both follow.
