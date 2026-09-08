## 2026-08-21 — Eski KN CHIQIM row in Hisobot: full request detail, not just kg

**Context.** Same-day follow-up to diagnosing why a real "eski KN" (old Konditirskiy) CHIQIM
request (plate `40B502BB`, 6,955 kg declared) was invisible in Hisobot despite showing as
"Olib ketildi" in the CHIQIM section and already being netted out of the eski KN pool balance —
root cause traced live: Ombor's "Yuklashni yakunlash" (the only action that writes an
`old_kn_collections` row, which is both what `report_old_kn_rows`/Hisobot reads and what drains
`old_kn_pools`) had not been clicked yet, even though Qorovul's gate stage-2 had already
completed and flipped `chiqim_requests.status` to `olib_ketildi` — the documented CHIQIM
per-role-finalization invariant (SPEC.md §5 intro) allows exactly this ordering. Once diagnosed,
the user asked for the follow-up: Menejer's own CHIQIM section already renders full detail (actor
+ time for Menejer/Ombor/Qorovul, all four gate photos, line composition) for every request
(`FinishedChiqimList.tsx`), but Hisobot's eski-KN row-expand (`OldKnRowDetail.tsx`) only ever
showed the collected kg — add the same full detail there, reachable the same way KIRIM/CHIQIM
rows already reach the serial passport.

**No new query, no migration — old-KN has no serial, so it gets its own request-scoped
drill-down instead of extending §3.2.5's serial passport.** `report_old_kn_rows.serial` is a
NULL literal by design (old-KN pools have no serial identity, per the original Stage 1 decision)
— §3.2.5's passport is explicitly a *parent-serial* drill-down, so bolting old-KN onto it would
mean inventing a fake serial concept. The request itself is old-KN's only real "parent," and all
the data to show already exists and is already correctly RLS-readable (`read_all` on
`chiqim_requests`/`chiqim_lines`/`gate_weighings`/`old_kn_collections`, confirmed via
`pg_policies` before writing anything) — this is a pure frontend reuse task, not a schema change.

**Extracted the existing render, didn't rebuild it.** `FinishedChiqimList.tsx`'s expand-panel body
(Menejer/Ombor/Qorovul-stage1/Qorovul-stage2 blocks + Yuk tarkibi) moved verbatim into a new
shared `src/components/ChiqimRequestDetail.tsx`, taking a `FinishedChiqimRequest` plus resolver
functions as props. `FinishedChiqimList.tsx` now renders it and keeps only its own
Menejer-specific write affordances (Tahrirlash/Bekor qilish) alongside it — those don't belong in
a read-only Hisobot passport. New `useChiqimRequestById(requestId)` (`useFinishedChiqimRequests.ts`)
is a single-request sibling of the existing bulk hook, sharing its exact column selects
(hoisted to `CHIQIM_LINE_SELECT`/`GATE_WEIGHING_SELECT` module constants so the two can never
drift) rather than pulling every `chiqim_requests` row into a modal that might be opened against
arbitrarily old Hisobot history.

**🐛 Real, pre-existing typing gap fixed in passing, required for the feature to render old-KN
lines correctly at all.** `FinishedChiqimLine.line_kind` was typed `'finished' | 'raw'` only — a
gap predating opening-stock Stage 2 (2026-08-02): `old_washed`/`old_kn`/`old_raw` lines were
already flowing through this exact query untyped-correctly, and `FinishedChiqimList.tsx`'s own
`lineLabel()` only branched on `'raw'`, so an old-KN line already rendered with a blank calibre
label in Menejer's own CHIQIM section before this task touched anything. Widened to all five
kinds and `lineLabel` (now inside `ChiqimRequestDetail.tsx`) given real branches for all five,
reusing `OmborChiqimTab.tsx`'s own established labels ("Eski (yuvilgan)", "Eski KN", "Eski xom")
rather than inventing new ones.

**The one genuinely new piece of information: the declared-vs-collected reconciliation, inline
on the old-KN line itself.** `useOldKnCollectionsByRequest.ts` gained `created_by` (additive
field, already-used-elsewhere hook, confirmed its one other caller — `OmborChiqimTab.tsx`'s W2
record — reads by field name and is unaffected by an added one). `ChiqimRequestDetail.tsx` shows,
under an `old_kn` line's declared `qty_kg`, either the real `old_kn_collections` row(s) (who
collected, when, how much) or — if none exist yet — an explicit amber note: *"Hali yig'ib
olinmagan — Ombor 'Yuklashni yakunlash' bosmagan, shu tufayli Hisobotda ko'rinmaydi."* This is
the exact diagnosis from the same-day investigation, surfaced directly in the UI instead of
requiring another SQL trace next time.

**Wiring.** `OldKnRowDetail.tsx` gained a "So'rov tafsilotlarini ko'rish →" button (same pattern
as `RawDispatchRowDetail.tsx`'s "Seriya pasportini ko'rish →", scoped to `row.requestId` instead
of a serial) calling a new `onOpenOldKnRequest` callback threaded through
`ReportTableRow.tsx`/`ReportRowCard.tsx`/`ReportResultsTable.tsx` exactly like `onOpenPassport`
already is. `HisobotTab.tsx` holds a second, independent `oldKnRequestId` modal-state var
alongside the existing `passportSerial` one and renders the new `OldKnRequestPassportModal.tsx`
(same chrome as `SerialPassportModal.tsx`: fixed backdrop, Escape-to-close, click-outside-closes,
narrower `max-w-2xl` since the content is one request, not a whole lifecycle).

**Verified against real live data (Supabase MCP, no migration to apply — frontend-only change).**
The same 6,955 kg request from the same-day diagnosis (`a8736526-…`, plate `40B502BB`) was used
as the real test case: confirmed via direct SQL that `chiqim_requests`/`chiqim_lines`/
`gate_weighings`/`old_kn_collections` join exactly the way the new hook's queries expect, field
names and all. Between the diagnosis and this fix, Ombor actually clicked "Yuklashni yakunlash"
live (visible via `ombor_finished_at` now set, a real `old_kn_collections` row now present,
`report_old_kn_rows` now returning the row) — so the "not yet collected" amber-note branch is
exercised by this exact request's own real history earlier the same day, not a synthetic case.
`pg_policies` confirmed `read_all` on all four tables for any authenticated role, so a real
Menejer/Rahbar session reads this by the same RLS every other Hisobot field already uses — no new
policy needed. `npx tsc -b --noEmit` and `npm run build` both clean, `npm run lint` unchanged
(one pre-existing unrelated warning), unit suite 82/82 unaffected (no logic in the existing bulk
hook changed, only extracted/shared).

**🚩 No live-browser hand-verification — this session's container had no `.env`/`.env.test`
(gitignored, absent from a fresh clone, same gap logged in the immediately-prior entry) and no
real Menejer/Rahbar login available, so the modal was never actually clicked open in a running
dev server. What *was* verified is listed above (real data shape via SQL, RLS, type-check, build,
lint, unit tests) — live click-through in the browser, called for by this app's own testing
workflow, still needs to happen before this is treated as fully confirmed, flagged explicitly
rather than silently skipped.

**Out of scope, not touched:** the client report's own old-KN section (`ClientReportTab.tsx`'s
`oldKn` block) may have the same "no drill-down" gap — not checked, not fixed, since the task's
own ask was Hisobot specifically. Raw dispatch (`chiqim_raw`) and moyka rows already have their
own drill-downs (serial passport); old-washed/old-raw dispatch lines' own reservation/scan detail
(distinct from the declared-vs-collected reconciliation added here) — not touched.
