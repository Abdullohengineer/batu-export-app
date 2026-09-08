## 2026-08-29 — Menejer CHIQIM: quantity-only entry, no tara

User report: "Menejer's CHIQIM form still requires picking QR codes. Prompt 4 should have
killed this. Also: I wrongly put tara on Menejer's form in prompt 4 — Menejer never enters
tara." Investigated both claims against the live code before changing anything.

**The QR/pallet-picker claim does not match the current code.** Read `ChiqimForm.tsx` in
full and cross-checked against the 2026-08-28 "CHIQIM quantity-based dispatch: FIFO cascade,
consumption table" entry (this session's own "Prompt 4"): Option B's pallet-reservation UI
(`chiqim_line_pallets`, `dispatch_manifest`) was already reversed that day — both tables
confirmed still empty in production. Today, `finished`/`old_washed` lines are calibre +
declared net kg only, no calibre-level pallet or QR picker of any kind. The one thing in the
form that resembles a "picker" is `raw`/`old_raw`'s source-serial pool selector (tap to
add/remove one or more serials as candidate draw sources for Ombor) — but that's plain
serial-ID buttons, not QR codes, and it's a different, load-bearing mechanism that predates
and is orthogonal to Option B: raw balance is tracked per owner-serial, so Menejer has to name
candidates, unlike finished goods which draw from a shared calibre pool via FIFO and never
needed this. Reported this distinction to the user rather than guessing they wanted it
removed too (CLAUDE.md: "if ambiguous, stop and report, don't invent a design") — left as-is,
not touched by this prompt. Whether the original report was against a stale/cached deployment
or was conflating the source-serial selector with a pallet picker is unclear; either way, the
code today has no QR/pallet picker for Menejer to interact with.

**The tara claim was confirmed and real.** `chiqim_lines.declared_tara_kg` (added alongside
the same 2026-08-28 redesign, migration 0087) was a required input on every `finished`/
`old_washed` row in `ChiqimForm.tsx` — carried over from KIRIM/raw-dispatch's own box-mass
fields without noticing Menejer never actually weighs a box. Tara belongs to Ombor alone, at
two points: §5.1 KIRIM intake (`storage_intake.box_mass_kg`) and this section's own
raw-dispatch load (`raw_dispatch_lines.box_mass_kg`, entered per-draw in `OmborChiqimTab.tsx`)
— both untouched by this prompt, per its own explicit "documented exception."

**Column dropped outright, not just stopped-writing** (migration
`0103_drop_chiqim_lines_declared_tara_kg.sql`), after confirming it was safe: zero real
`finished`/`old_washed`/`old_raw` rows exist yet in production (only `raw` (4) and `old_kn`
(3) lines have ever been created, and neither kind ever wrote this column — `tara_sum = 0` for
both), and a direct `pg_proc.prosrc`/`pg_views.definition` text search for the column name
returned zero hits — no SQL function or view reads it. No RLS policy references it either
(`chiqim_lines`' own `menejer_writes` `WITH CHECK` is role-only). Written only by
`ChiqimForm.tsx`, displayed only by `useOmborChiqimRequests.ts`/`OmborChiqimTab.tsx` — all
three updated in the same commit as the migration; nothing else in the codebase referenced it
(confirmed via a repo-wide grep for `declared_tara_kg`/`taraKg` before and after).

**`ChiqimForm.tsx` also gained a "Mavjud: X kg" read-only reference line** (task's own
explicit ask), shown above the qty input once type+calibre are picked, for `finished`/
`old_washed` rows only — `raw`/`old_raw` already show `X kg mavjud` per source-serial button,
and `old_kn` already shows its own pool balance in its own note, so neither needed a second
copy. Reads the same `useFinishedCalibreAvailability` balance the existing feasibility warning
already reads (`availableKg(row)`, unchanged) — a plain reference, never a gate; the warning
itself (shown only when the declared kg exceeds it) stays exactly as it was, unchanged.

**Verified:** `npx tsc --noEmit`, `npx oxlint`, `npm run build` all clean. `node --test`:
67/67, unchanged (a display/validation removal — no new pure-function logic to cover).

**Testing (task's own "one TEST- walkthrough per line_kind"):** not run this session — same
disclosed sandbox limitation as every prior prompt (no `.env.test`, no real login session
obtainable here). Flagged, not silently skipped. The change itself is small and mechanical
(remove a required field + its validation/insert/display, add one read-only text line) and
`tsc`/`build` catch every type-level consequence of removing `declared_tara_kg` end-to-end;
what those checks cannot confirm is the live UX — whoever picks this up next should submit one
`TEST-`-prefixed CHIQIM request per `line_kind` (`finished`, `raw`, `old_washed`, `old_kn`,
`old_raw`) against the deployed app and confirm: no picker, no tara field, "Mavjud: X kg"
shows correctly for the two calibre kinds, and submit succeeds.

**Out of scope, untouched:** the raw/old_raw source-serial pool selector (flagged, not
removed — see above), Ombor's own raw-dispatch box-mass entry (the documented exception, per
the task's own text), the FIFO cascade/consumption-ledger mechanism itself, KIRIM's
`storage_intake.box_mass_kg`.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/global-export-profile-setup-t1hl6t`.
