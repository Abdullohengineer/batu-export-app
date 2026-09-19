# Client Расход rewritten to one row per truck (dispatch event)

## What changed

`client_chiqim_ledger(date,date,text[],uuid)` regrained from one row per
serial (0115/0117) to one row per `chiqim_requests.id` (one truck). No
backwards-compat needed -- the old per-serial frontend is deleted
alongside this migration (`0125_client_chiqim_ledger_per_truck_grain.sql`).

`serial` is dropped from every CTE in the function -- with the new grain
there is no per-serial breakdown anywhere in the design (explicit
instruction), so it was genuinely unused, not just hidden from the
response.

New row shape: `requestId`/`date`/`plate`/`driver`/`kinds`/`totalKg`, plus
two server-computed breakdowns for the expand panel:
- `typeBreakdown` -- this truck's cargo summed by product type. Needed
  because a serial is single-type by construction (CLAUDE.md) but a truck
  is not -- a truck can carry more than one Вид сырья, which the old
  per-serial grain never had to represent.
- `calibreBreakdown` -- only from `'tayyor'`/`'eski_yuvilgan'` lines.
  `'konditerka'`/`'rezka_kn'` do carry a `calibre_id` but it's structurally
  a single always-KN bucket (redundant with `typeBreakdown` — showing
  "KN: 6,955 kg" under a "по калибрам" heading tells the reader nothing
  `typeBreakdown` didn't already), and `'vozvrat'`/`'eski_kn'` have no
  `calibre_id` at all (raw dispatch, KN pool draw). Confirmed live: every
  `eski_kn`/`vozvrat` truck in the test data returns `calibreBreakdown: []`
  exactly as expected, not an error or a spurious single-entry array.

Frontend: `ClientRashodTab.tsx`, `clientChiqimLedger.ts`,
`clientChiqimLedgerExport.ts` rewritten in place (same routes, same
taxonomy constants -- `TIP_OPTIONS`/`TIP_COLOR`/`tipLabel`/`tipsForKinds`/
`tipTotals` are grain-independent and untouched). Top-level columns now
Дата/Тип/Машина/Водитель/Всего кг (Вид сырья and per-calibre totals moved
into the expand panel, since they can no longer be single-valued at truck
grain); "Отгрузок" (dispatch count) column dropped -- each row already
*is* one dispatch, so a count of 1 everywhere would be noise. Sort is
newest-first by `request_date` (the old per-serial version sorted
alphabetically by serial, which no longer exists as a sort key at this
grain; a Дата-led table reads naturally newest-first, matching this app's
own history-screen convention). Excel export mirrors the on-screen
structure: Дата/Тип/Машина/Водитель/Всего кг plus widened `Вид N`/`Калибр
N` column pairs (variable count, sized to the widest row), replacing the
old per-serial export's `N1..N(max)` dispatch-detail columns (no longer
meaningful -- each Excel row is already one dispatch).

## Checked for reuse against the internal Hisobot's own dispatch regrain

Per this task's own flag from an earlier planning pass: the internal
staff Hisobot independently regrained its own CHIQIM reporting onto
dispatch events (PRs #148/#149, `ChiqimDispatchReportRow` in
`reportQuery.ts`, `chiqim_dispatch_calibre_breakdown`,
`0189-...-chiqim-dispatch-full-detail-and-kalibr-breakdown.md`). Read that
shape before designing this one: it uses fixed `dispatchK1..dispatchK8`/
`dispatchKn` columns, because it feeds a generic wide desktop table with
column-picker infrastructure that every other Hisobot row kind also has
to fit into. The client Расход table has no such constraint -- it is a
bespoke, compact table with its own expand panel, not a column-picker
table -- so a variable-length `calibreBreakdown` array is the better fit
here, not a shortfall relative to the internal convention. Same
underlying idea (no per-serial identity at dispatch grain), two different
and both-correct shapes for two different UIs.

## Verification

- Live role-switched query (TEST client, `p_kinds := NULL, p_type_id :=
  NULL`, full period): 11 truck rows, sorted newest-first, correctly
  split a mixed-type truck (`d43103ff...`, 22,610 kg = 14,400 kg Subxon +
  8,210 kg Isfara in `typeBreakdown`) and correctly emptied
  `calibreBreakdown` for every `eski_kn`/`vozvrat` truck. `totals.totalKg`
  (120,511 kg) exactly equals the sum of `totals.byKind`
  (21,782 + 8,640 + 65,360 + 24,729), and `totals.byKind['vozvrat']`
  (24,729 kg) matches `rahbar_dashboard_ledger('yangi').raw.dispatchedKg`
  for the same owner/period from `0197`'s own verification run -- same
  underlying `raw_dispatch_lines`, independently confirmed consistent.
- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` -- all clean.
- The pre-existing `client_chiqim_ledger(date,date,text[])` 3-arg overload
  (no `p_type_id`) is a confirmed-dead orphan from before 0117 added the
  4-arg version -- left untouched, out of scope for this task and
  consistent with not dropping backend objects speculatively (0119's own
  incident).
- Not independently verified against a live rendered DOM (this sandbox
  cannot reach the live Supabase/Netlify hosts) -- relied on the live SQL
  role-switch test above plus structural/type-level checks for the
  frontend, same limitation as `0195`-`0197`.
