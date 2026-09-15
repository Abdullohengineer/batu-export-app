# Netlify build break: root-caused to two pre-existing `tsc -b` gaps, not PR #154

## What was reported

Every Netlify production build has failed since `2506962` (PR #143,
Sep 14 2:33pm, last "Published" deploy) — 7 real failures across
PR #144–#154, confirmed from the Netlify dashboard's own deploy history
(the "Canceled" entries in between are builds superseded by a newer push
before they finished, not pass/fail signal). PR #154 (this branch,
`03b4f35`/`a764f01`, the Hisobot CHIQIM dispatch-columns + seriya-link fix)
was blamed initially, with a specific claimed root cause ("`ReportRow.kind`
typed as `'kirim'` only").

## Investigation

`node_modules` was empty in this session's sandbox at the point this was
raised — every earlier `tsc --noEmit` run this session had been silently
checking nothing (`tsconfig.json` is a solution-style file with `files: []`
and only `references`; `--noEmit` without `-b` doesn't traverse project
references, so it type-checks zero files against that particular
tsconfig). `npm ci` restored dependencies; re-running the actual Netlify
build command (`tsc -b && vite build`, per `netlify.toml`) then failed for
real, confirming the report — but not confirming its stated cause.

**Two distinct, chained pre-existing bugs**, neither touching any file
PR #154 changed (verified: none of `reportColumns.ts`,
`ChiqimRequestDetail.tsx`, `ChiqimRequestPassportModal.tsx`,
`HisobotTab.tsx` appear anywhere in the 21-error output). Bisected by
checking out each failing commit in a clean detached `HEAD` and
re-running the real build command:

1. **`TotalsStrip.tsx`'s dead `'both'` comparisons** (2 errors,
   `TS2367`) — introduced at `9dde78b` (PR #144, the first failure right
   after `2506962`), confirmed present at every failing commit through
   `46da948`, including `bc314e5` (PR #148, the last one before bug 2
   below lands). `ReportColumnTotalBasis` (`reportColumns.ts`) has been
   `'movement' | 'state' | 'none'` since before this — `'both'` was
   removed from the type but two `|| c.totalBasis === 'both'` clauses in
   `TotalsStrip.tsx` were never pruned. Confirmed dead, not a behavior
   change: grepped `reportColumns.ts`, no column has ever set
   `totalBasis: 'both'`.
2. **`mapDbRowToReportRow`'s return type never widened for its own legacy
   branch** (19 errors, `TS2322`/`TS2339`/`TS2352`, cascading) —
   introduced at `1527de6` ("Regrain Chiqim onto consumption events...",
   landing on `main` via PR #149/`fe22cc9`). That commit correctly
   narrowed the *exported* `ReportRow` union to the 4 kinds the main table
   renders (`kirim`/`chiqim_dispatch`/`moyka_send`/`moyka_output`) and
   correctly left `ChiqimReportRow`'s own legacy per-pallet branch in
   place — its own comment already says it "survives as the return type
   of ONE caller only... `fetchVoidedBarcodeMatch`." What it missed: the
   function whose body still builds that legacy shape
   (`mapDbRowToReportRow`) was never given a return type wide enough to
   say so, so its own unconditional trailing `return { kind: 'chiqim',
   ... }` stopped type-checking against its own signature. The function
   body was never wrong — `fetchVoidedBarcodeMatch` and
   `reportQuery.test.ts`'s own pre-existing CHIQIM-row tests already
   exercised it correctly; this was purely a signature gap.

Confirmed complete: checked `bc314e5` (PR #148, last commit before bug 2
lands) shows only the 2 `TotalsStrip` errors, ruling out a third distinct
bug hiding in that window. Every failing build from `9dde78b` onward is
fully explained by these two, no others found.

## Fix

- `TotalsStrip.tsx`: dropped the two dead `|| c.totalBasis === 'both'`
  clauses. No behavior change (nothing ever set that value).
- `reportQuery.ts`: widened `mapDbRowToReportRow`'s return type to
  `ReportRow | ChiqimReportRow` — one line, no body change. This is
  what the type comment already said the shape should be; the function
  just never said so itself.
- `useReportQuery.ts`: the widened return type now leaks into the two
  callers that feed the main table/export (`report_query_page`-backed,
  which per `ReportDbRow.kind`'s own comment never emits `kind: 'chiqim'`)
  — added `as ReportRow[]` at both call sites with a comment citing that
  invariant, rather than widening every downstream consumer's type for a
  case that can't occur there. `fetchVoidedBarcodeMatch`'s existing
  `as ChiqimReportRow` cast now type-checks correctly unchanged (it's a
  narrowing cast onto a member of the function's own now-correct return
  union).

Deliberately did NOT adopt the literal fix shape first proposed (rebuild
`ReportRow` as `KirimReportRow | ChiqimReportRow | MoykaOutputReportRow`)
— that shape both omits `MoykaSendReportRow`/`ChiqimDispatchReportRow`
(real, current kinds) and reintroduces `'chiqim'` into the union the main
table switches on, which is exactly what `1527de6` deliberately moved
away from (a rolled-up dispatch line is not one pallet). The actual gap
was narrower and didn't require touching the union other callers depend
on.

## Verification

- `npm run build` (`tsc -b && vite build`, the literal Netlify command) —
  exit 0, clean, from a fresh `npm ci` with `node_modules/.tmp` and
  `dist/` cleared first.
- `npx tsx --test src/lib/reportQuery.test.ts` — 13/13 passing, unchanged
  (the pre-existing CHIQIM-row tests that had been failing to type-check
  now pass again against the corrected signature; no test logic changed).
- Bisected and reproduced the exact failure at `9dde78b` and `bc314e5`
  (detached checkout, clean `npm run build`) before touching any code, to
  separate "pre-existing, unrelated to this PR" from "something to fix
  here" rather than assuming either way.
- 🚩 **Investigated and ruled out a false lead, documented here so a
  future session doesn't re-chase it**: a local `vite build` output in
  this sandbox, searched for literal strings like `"Ustunlar"`/
  `"HisobotTab"`/`"rahbar"`, appears to be missing the entire
  route/screen tree beyond the login shell (a suspiciously small bundle,
  ~342KB min/101KB gzip for an app this size, and a Vite build-API probe
  confirms `HisobotTab.tsx` and every other route file genuinely gets
  transformed but its output doesn't survive to the final chunk). Ran the
  decisive control experiment before treating this as a new problem:
  built `2506962` — the last commit Netlify actually published
  successfully — fresh in this same sandbox, and it shows the **identical
  signature** (same absent strings). Since that exact commit is proven
  working in real production, this is a property of this sandbox's local
  build/inspection (Vite 8.1.4's Rolldown-based bundler, `node-v22.22.2`,
  possibly a string-pooling optimization my substring search doesn't
  account for, or something else environment-specific) and not a defect
  in the app or in this fix. Not chased further — out of scope for what
  was asked, and the one thing that matters (`tsc -b` exit code) is
  already validated against the real build command.

## Process note

Every earlier "`tsc --noEmit`, clean" claim from this branch's own prior
sessions (including this task's own earlier turns) was checking nothing,
for the reason above — the root tsconfig.json's empty `files` array means
`tsc --noEmit` silently no-ops unless invoked with `-b` (or `-p` against
one of the two real sub-configs). Recommending a pre-push/CI guard that
runs the literal `npm run build` (not a bespoke `tsc --noEmit` invocation)
so this class of false-clean result can't recur silently — left as a
follow-up, not bundled into this fix.
