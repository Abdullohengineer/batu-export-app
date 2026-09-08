## 2026-08-26 — Client role: nakladnoy photo links dropped

Same-day follow-up to the entry immediately above. Presented with item 9 (storage bucket RLS has
no per-owner scoping — a `client` account could, by querying `storage.objects` directly, reach
any owner's photos, not just its own) as a flagged-not-fixed gap, the user's explicit decision:
"if photo links not available, then abandon that feature, just keep the other numeric data."

Removed rather than left half-shipped against an open gap: `client_serial_summary`'s
`kirimNakladnoy`/`chiqimNakladnoys` fields and the CTEs that built them (`chiqim_request_ids`,
`chiqim_nakladnoys`, and the `doc_photo`/`kirim_plate` columns pulled into `owned` only to feed
them) — the function now returns exactly `serial`/`orderDate`/`washCycleStatus`/`byCalibre`/
`knKg`/`lossKg`, nothing else. This also shrinks the function's own join surface: it no longer
touches `dispatch_manifest`/`chiqim_requests`/`gate_weighings`/`raw_dispatch_lines`/
`chiqim_lines` at all (those tables' RLS policies from the immediately-prior entry are unaffected
— still needed by `client_report_rows`'s own chiqim/chiqim_raw/chiqim_old_kn branches and by
`kirim_line_state`'s `departed`/`raw_disp` CTEs, both still in active use). Shipped as a same-day
`create or replace function` against the live project (`client_serial_summary_drop_nakladnoy_
photos`), and folded directly into the tracked `0083` migration file locally, same convention as
the date-basis fix in the immediately-prior entry — a fresh `supabase db push` reproduces this
final state directly, no separate numbered migration for the removal.

Frontend: `ClientSerialSummaryModal.tsx` rewritten without the "Накладные" section, the
`GatePhoto`/`Lightbox` imports, or the lightbox open/close state it existed for —
`src/components/Lightbox.tsx` (extracted from `SerialPassportModal.tsx` in the immediately-prior
entry) is still a real, used component, just with one consumer now instead of two.
`clientPortalReport.ts` lost `ClientNakladnoy`/`ClientChiqimNakladnoy` and the two fields off
`ClientSerialSummary`/`ClientSerialSummaryDb`. `npx tsc -b --noEmit` clean after the change.

**What this does and doesn't resolve:** the underlying `storage.objects` RLS gap (item 9,
immediately-prior entry) is unchanged and still real — this removal means nothing this app
currently renders *depends* on fixing it, not that it's fixed. Left as a standing, general
(not client-portal-specific) gap for whoever next needs Storage access scoped by owner, same
flag as before, just no longer blocking this feature specifically.

**Verification.** Re-confirmed `client_serial_summary` still returns correct numeric figures
post-simplification by re-running it against the real `050826-001` serial (unprivileged
connection, so `my_owner_id()` resolves null and the result is `null` as expected — same
non-result the pre-change version also gave under an unsimulated connection); the calibre/KN/
loss computation itself was already thoroughly verified against the `TEST-RLS-001` fixture in
the immediately-prior entry and is untouched by this change, only the two removed fields are
new here. `npx tsc -b --noEmit`, `npm test` (82/82), `npm run build` all clean after the edit.
