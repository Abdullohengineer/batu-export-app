# Hisobot CHIQIM dispatch: kalibr columns default-visible, seriya link wired

## What was reported

Two bugs against HARAKATLAR BO'YICHA (Hisobot):

1. "Kalibr breakdown columns (K1..KN) all show 0 kg for every row" while
   viewing Chiqim movements, despite the row's own Netto/summary totals
   being correct.
2. The passport link (seriya/partiya reference) in the rows is not
   clickable.

Both are direct follow-ups to `0189` (chiqim dispatch full detail +
kalibr breakdown, applied and committed as `03b4f35` immediately before
this task): `0189` itself flagged "UI-level verification not performed
this session" and, for the seriya-link regression specifically, said
outright "not reproducible... the operator will check live and report
back." This is that report-back.

## Investigation

**Bug 1 — re-verified the whole pipeline against live data first, before
touching anything**, per this project's own schema-inspection rule.
Queried `report_query_page(['chiqim'], ...)` directly against project
`qohoqbapevrcjqxbstxi` for the live CHIQIM dispatch rows: `dispatch_k1..
dispatch_kn` come back correctly populated and sum exactly to each row's
own `qty_kg` (pallet-only lines) — e.g. request `545883f6...`:
`dispatch_k1=2550, dispatch_k2=5760, dispatch_k4=12020`, summing to its
full 20,330 kg row total, matching the bug report's own cited Netto figure
exactly. Traced `mapDbRowToReportRow`/`ReportTableRow.tsx`/`StateCell` —
all three map/render `null` as `null`, never `0`; a genuinely-blank kalibr
can never render literal "0 kg" through this path, only "—".

**Conclusion: the data and the code computing it were never wrong.** The
real gap is that `0189` shipped these nine columns `defaultVisible: false`
(explicit "same expandable-via-picker precedent" choice at the time).
They sit in the column picker right next to the pre-existing, near-
identically-labelled `k1`..`kn` ("K1, kg"..."KN, kg") — the SERIAL's own
wash-output composition, genuinely and correctly blank on every
`chiqim_dispatch` row (no single serial at dispatch grain, see
`reportColumns.ts`'s own comment on that block). A viewer who reaches for
"K1, kg" while looking at Chiqim rows finds it blank by design and
reasonably reports the feature as broken — the nine columns that
actually answer "what caliber did the truck carry" were there, just not
on screen and not obviously the ones to pick over their same-named,
wrong-grain siblings.

**Fix: flip `defaultVisible: true`** on `dispatch_k1..dispatch_kn` only
(same precedent already used for `moykaga_yuborilgan`/`yoqotish` —
"asked for on every row without hunting through Ustunlar first"). Left
everything else from `0189` untouched: the deliberate key/label
separation from `k1`-`kn` stays (still the right call — same metric-
collision reasoning as `moykaga_yuborilgan`'s own precedent), no strip
chip added (still an explicit, separate decision), `report_query_page`/
`chiqim_dispatch_calibre_breakdown` unchanged (nothing wrong with them).

**Bug 2 — traced the actual component the operator would have landed on**:
`ChiqimDispatchRowDetail.tsx`'s own inline pallet-manifest table (the row's
own expand panel) already renders `serial` as a working `onOpenPassport`
button — that one was never broken, consistent with `0189`'s static trace.
But `0189`'s Fix 1 made "So'rov tafsilotlarini ko'rish →" reachable from
*every* dispatch line, not just old-KN's — and that button opens
`ChiqimRequestPassportModal` → `ChiqimRequestDetail`, a DIFFERENT,
pre-existing component (reused unchanged from Menejer's own
`FinishedChiqimList.tsx`). That one's own "Yuk tarkibi" manifest list
never took an `onOpenPassport` prop at all — never had one, on either of
its two call sites — and didn't even render `serial`, only
barcode2/type/calibre. Before `0189` widened the button's reach, almost
no one saw this list with pallet cargo in it (it was old-KN-gated), so the
gap went unnoticed. Not a regression in the sense of "used to work" — a
pre-existing gap in a component that only just became reachable for the
common case.

## Fix

- `ChiqimRequestDetail.tsx`: added optional `onOpenPassport?: (serial:
  string) => void`; manifest list now shows `serial` as a clickable
  button (same pattern/classes as `ChiqimDispatchRowDetail.tsx`'s own)
  when the prop is given, plain text otherwise. Optional because
  `FinishedChiqimList.tsx` (Menejer's screen) has no `SerialPassportModal`
  mounted to hand it — left that call site unchanged, out of scope for
  this report (only Hisobot was reported broken).
- `ChiqimRequestPassportModal.tsx`: takes `onOpenPassport` (required —
  this call site always has one), threads it through.
- `HisobotTab.tsx`: wires it as `(serial) => { setChiqimRequestId(null);
  setPassportSerial(serial) }` — closes the request modal and opens
  `SerialPassportModal` instead of stacking both. Both modals are `fixed
  inset-0 z-50`; mounting both simultaneously would paint whichever
  renders later in the tree on top, not necessarily the one just opened,
  and no nested-modal precedent exists anywhere else in this app to
  follow instead (every other passport drill-down opens from a plain row,
  never from inside another modal). Switching modals sidesteps the
  z-index question entirely rather than inventing a stacking convention
  for one call site.

## Verification

- `npx tsc --noEmit` — clean.
- `npx tsx --test src/lib/reportQuery.test.ts` — 13/13 passing, unchanged
  (this fix touched no query/mapping code, only column-visibility default
  and one component's props).
- Live SQL re-confirmed (see Investigation above) against project
  `qohoqbapevrcjqxbstxi` — same numbers `0189` verified, still correct
  post-`03b4f35`.
- 🚩 UI-level click-testing not performed this session either — same
  constraint as `0188`/`0189` (no `.env.test`, no authenticated Playwright
  session available in this container). The fix is narrow (a visibility
  default flip + threading one existing, already-proven `onOpenPassport`
  pattern into a second component) and both call sites verified
  statically; flagging per this project's own testing-workflow rule
  rather than claiming a click-test that didn't happen.

## Related

- `docs/decisions/0189-2026-09-15-chiqim-dispatch-full-detail-and-kalibr-breakdown.md`
  — the fix this entry follows up on; both bugs here are its own
  admitted UI-verification gap turning out to hide something real (bug 2)
  and a genuine-but-different problem (bug 1: a visibility default, not
  the SQL/mapping layer `0189` built and verified).
