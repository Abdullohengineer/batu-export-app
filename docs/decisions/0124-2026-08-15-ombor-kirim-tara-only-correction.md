## 2026-08-15 — Ombor KIRIM tara-only correction
**Context:** tara is the only figure Ombor enters himself at intake — everything else on that
screen (declared, gate weights, lab readings) is prefilled and read-only. A real correction request
(serial `150826-001`, box mass 355 → 513 kg) exposed that there was no in-app way to fix a tara
entry after the fact; the SQL-console fix for that one serial is its own entry above. This entry
covers the general feature: a Tahrirlash button on Ombor's KIRIM screen, tara only.

**Four questions investigated before writing any code, per the user's explicit request:**

1. **Retroactive mutation** — covered in full in the entry immediately above this one
   ("`report_kirim_rows_as_of` gates event visibility, not values"). Short version: no protection
   exists or was ever intended to exist against a later correction changing what an already-issued
   report would show if regenerated for the same period.
2. **Downstream movement — block, warn, or allow-with-impact?** Chose **allow, with impact shown**,
   not a hard block. `moyka_sends` has no DB-level constraint tying `qty_kg` to any live balance
   (confirmed directly — its only check constraint is `qty_kg > 0`); `available` is already a
   purely client-computed, floored figure that silently tolerates over-commitment today, with no
   correction path at all. A tara edit creating the same over-commitment is the same failure mode
   through one more door, not a new one — and it matches this app's consistent house style
   elsewhere (Tugallash's non-blocking soft warnings, CHIQIM's out-of-pool draw warning): surface
   the number, let the human decide.
3. **Write path.** Corrected mid-investigation: tara lives on `storage_intake.box_mass_kg`, not
   `kirim_lines` (which has no tara column at all). Unlike `kirim_lines`, `storage_intake` already
   had a row-level `ombor_updates` UPDATE policy, unrestricted by column — checked directly and
   confirmed unused (zero client call sites `.update()` or `.upsert()` storage_intake; the only
   write is the accept-time `.insert()`, a different policy; the app's only two `.upsert()` calls
   both target `wash_cycles`). Of the 6 DB functions referencing `storage_intake`, 2 are
   `security definer` (structurally cannot depend on any RLS policy) and the other 4 only `SELECT`
   it, covered by `read_all`. Dropped `ombor_updates` in the same migration as the new RPC —
   otherwise the RPC's own restriction to one column would have been cosmetic, with the real access
   still wide open underneath.
4. **Expiry.** Checked both existing Tahrirlash implementations directly (`KirimOrdersList.tsx`,
   `FinishedChiqimList.tsx`) — neither is actually time-based; both lock on an **event**
   (`gate_weighings` existing, `ombor_finished_at`/`voided_at`). No clock-based "editable for N
   hours" lock exists anywhere in this codebase to mirror, and one would actively work against the
   user's own stated need ("a box-count correction can legitimately surface days later"). No
   expiry — matches `is_sulfured`'s own precedent (freely correctable indefinitely, the audit trail
   is what makes that safe, not a lock).

**`correct_kirim_line_tara(p_serial, p_box_mass_kg)`** — `security definer`, matching
`classify_kirim_line_sulfur`'s pattern: `my_role() = 'ombor'` check, rejects null/negative tara,
locks the row (`for update`), no table-level UPDATE policy behind it. Returns
`before/after_box_mass_kg`, `before/after_effective_qty`, `sent_kg`, `raw_dispatched_kg`,
`new_available_kg` in one call — no separate dry-run/preview RPC, since the client already has
everything needed to show a pre-save preview from data it has already loaded (declined to build
that preview client-side specifically to avoid a THIRD hand-written copy of the netto formula, see
below).

**Extracted, not copied a third time:** the netto/effective_qty formula
(`report_kirim_rows.qty_kg`'s own CASE expression) was already hand-duplicated once
(`report_kirim_rows_as_of`); this RPC needs it twice more (before/after its own write). Pulled into
`kirim_line_effective_qty(p_serial)` — a plain `stable sql` function, not `security definer` (it
inherits the caller's effective privileges when invoked from inside the definer RPC, same as any
nested call) — called twice inside `correct_kirim_line_tara`, once before the `UPDATE`, once after
(same transaction, so the second call sees the write). **Not** read from `report_kirim_rows`
directly: that view excludes `plate ~~ 'TEST-%'` rows, and this RPC has to work correctly against
disposable test fixtures too. **Verified byte-for-byte before shipping**, not just spot-checked:
ran the extracted formula against all 17 real `kirim_lines` rows live in the database and compared
to `report_kirim_rows.qty_kg` directly — 0 mismatches, covering both branches those rows currently
exercise (single-line gate-finalized, multi-line finalized). The other two branches (pre-intake,
intake-provisional) are plain pass-throughs with no box-mass/gate arithmetic — confirmed identical
by direct clause-by-clause text comparison; no live data in those states to empirically check
today. The view itself is untouched — not adopted to call the new helper in this pass — see the
entry above for why and the note that it's a future candidate.

**Migration applied in two passes** (`0072_correct_kirim_line_tara_rpc.sql`): shown to the user as
a complete draft, two corrections requested (extract the formula instead of copying it twice;
confirm no `.upsert()` before dropping the policy, not just `.update()`), both addressed and
re-verified (including a `BEGIN…ROLLBACK` dry run confirming the SQL compiles and a follow-up
confirming nothing persisted) before applying for real.

**Frontend** (`OmborIntakeTab.tsx`): a ✎ `IconButton` beside the existing ⋯ (Batafsil) on every
Window 2 card opens an inline form (`FormField`/`TextInput`, matching `KirimOrdersList.tsx`'s own
Tahrirlash pattern) with just the tara field, pre-filled from `line.intake.box_mass_kg`. Client-side
validation (non-negative, numeric) blocks an obviously-bad submit before it ever reaches the RPC.

🔒 **Real bug found and fixed during live testing, not just claimed clean:** the first
implementation rendered the RPC's returned impact as a confirmation *inside the same row's card*.
Window 2's own membership is `hasRawRemainder(effective_qty, sent)` (§5 intro, unchanged) — and a
correction that pushes `sent` past the new `effective_qty` is exactly the over-committed,
allow-with-impact case this feature exists to surface. Tested with a disposable fixture
(`TEST-TARA-02`, sent 900 against an original 950 netto, tara corrected 50 → 150 kg, dropping netto
to 850): the write succeeded and the RPC returned the correct numbers, but the row disappeared from
Window 2 the instant `refresh()` re-ran — taking the per-row confirmation down with it before the
operator could ever read the warning it existed to show. **Moved the confirmation to a page-level,
dismissible banner** above both windows instead, keyed to the corrected serial, independent of
whichever window it ends up in — re-tested with a second fixture (`TEST-TARA-01` → replaced by
`TEST-TARA-02` after the first attempt already left Window 2 before the fix landed): banner
correctly showed "`150826-012`: Tara 50 → 150 kg. Netto 950 → 850 kg." plus "Yuborilgan 900 kg ·
Xom jo'natilgan 0 kg · Yangi qoldiq 0 kg" and the red over-commit warning line, all visible even
though the row itself was gone from both windows by the time it rendered.

🔒 **Known limitation, flagged rather than silently fixed or silently left undocumented:** the same
mechanism that broke the confirmation banner has a second consequence the banner fix doesn't
address — once a serial's sent quantity reaches its (corrected) netto, `hasRawRemainder` removes it
from Window 2 **permanently** (from this screen's perspective), so **Tahrirlash itself becomes
unreachable for that serial from Ombor's KIRIM tab**, even though `correct_kirim_line_tara` has no
such restriction server-side. This directly cuts against the "no expiry" answer to question 4 above
— the RPC has none, but the only button that calls it effectively does, via window membership
rather than a deliberate lock. Not fixed this round: the clean fix would mean either changing
Window 2's own membership rule (a shared, named "section mirroring" invariant §5.2 also reads,
out of this task's stated scope of "Ombor frontend only... anything behavioural inside the sections"
— wait, this IS inside the section this task touches, but the rule itself is cross-section shared
state, higher risk to touch for a button-add task) or adding a second entry point elsewhere (e.g.
the serial passport). Flagged here and in SPEC.md rather than resolved unilaterally either way.

**Testing:** logged in as `TEST Ombor`. Confirmed the form pre-fills the real current tara (513 kg
on `150826-001`) and a genuine no-op save (513 → 513) both leaves `box_mass_kg` unchanged and writes
**no** new `audit_log` row (confirmed directly: still exactly 1 row for that serial, the original
manual correction) — the RPC's no-op guard works from the UI, not just in isolation. Confirmed
client-side validation rejects a negative tara (`-5`) before any RPC call — `box_mass_kg` on the
test row unchanged, confirmed directly. Confirmed the over-commit warning path end-to-end (above).
`npx tsc -b --noEmit` and `npm run lint` clean throughout. All fixtures (`TEST-TARA-01`,
`TEST-TARA-02` — orders, lines, gate weighings, storage intake, moyka sends, and any `audit_log`
rows referencing either) fully deleted afterward, confirmed zero remaining via direct query — not
voided, matching this session's own established convention for interactive manual fixtures (as
opposed to the automated-suite void-on-cleanup rule, which is for repeat `TEST-`-prefixed CI runs).

**Out of scope, not touched:** the Hisobot/nav work from earlier this session (separate branches),
Rezka, and — per the "known limitation" above — Window 2's own membership rule.
