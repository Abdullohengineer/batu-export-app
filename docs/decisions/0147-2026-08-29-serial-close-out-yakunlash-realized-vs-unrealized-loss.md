## 2026-08-29 — Serial close-out (Yakunlash) + realized-vs-unrealized loss

Three bundled changes: a manual/natural close event for a Moyka serial (Yakunlash), a
realized-vs-unrealized split of the live loss figure that closure enables, and a Window 2
reprint button for Barcode #2 stickers.

**Partial reversal of the same-day-earlier "Moyka loss becomes live; remove Tugallash" (0086)
entry.** That migration's own thesis was "no user action ever closes a serial" — every gap
(`sent − received`) was computed live and unconditionally, for every serial, forever. What its
header note never flagged: with no closure event, there was also no way to ever BOOK a residual
as a real, final loss. A serial that plateaus with material genuinely gone (spillage, a
miscount, a truck that never came back) just sits there reading "still in Moyka," accumulating
kg no one will ever pack, with no path to write it off. This shipped and immediately hit a real
case: **Isfara P3, 567 kg**, stuck with nowhere to go — confirmed live via `kirim_line_state`
against real production data (`150826-001`, sent 7947 / received 7380, exactly the reported
gap) before writing a line of this migration, not assumed. This prompt does not undo 0086's live-
computation model — the gap is still computed the exact same way, live, off the same event logs
— it adds back exactly one thing 0086 removed too completely: a way to say "this one is done."

**Before-coding audit, same shape as 0086's own 8-item list, re-run against every one of those 8
plus 4 more this pass found** (full list and reasoning lives in the migration's own header,
`supabase/migrations/0101_yakunlash_realized_loss_split.sql` — renumbered from 0100 to 0101 when
merging main: a concurrent PR (#116, "Six serials' output-by-kalibr weights...", entry above)
independently claimed 0100 for its own migration and merged first; both were applied live
independently before the collision surfaced, so this is a filename renumber only, not a re-apply):
`kirim_line_state` (foundational —
Hisobot's `state_moykada` and the new client-portal `state_moykada_kg` both inherit its fix for
free), `isInMoyka` (frontend, **not** in 0086's own list — found this pass: without a third
`closedAt` param a closed serial with a residual would stay receivable and stay shown as WIP
forever), `yield_rows`, `get_client_report`, `rahbar_dashboard_ledger`, `rahbar_stock_snapshot`,
`client_serial_loss_kg` (cascades into `client_report_rows`/`client_report_totals`/
`client_serial_summary`, all three confirmed via direct read to already call it),
`get_serial_passport`, `wip_rows` (inherits via `kirim_line_state`, confirmed via a direct live
`pg_get_viewdef` read that it already joins that function), plus three genuinely new additions
this prompt introduces (`client_report_rows`/`client_report_totals` gain `state_moykada_kg`,
`client_serial_summary` gains `moykadaKg` via a new sibling `client_serial_moyka_kg`).

**Four design forks, put to the user before writing any code, all resolved before coding began:**
1. **Yield scope** — revert to closed-only (`closed_at IS NOT NULL`), not "keep every serial,
   dash when unrealized." Yield is a completed-batch metric; an in-process serial has no stable
   yield% yet. Symmetric with reintroducing a real closure event, and closes a latent false-
   positive risk 0086 had introduced (a barely-started serial's temporarily-large gap could trip
   `rahbar_exceptions`' `high_loss` threshold purely from being mid-process — confirmed `rahbar_
   exceptions` reads `yield_rows` directly with no wash_cycles reference of its own, so it
   inherits the fix for free).
2. **Loss date basis** — `get_client_report`'s `processedBreakdown.lossKg`/`raw_processed_total`
   and `rahbar_dashboard_ledger`'s equivalent switch from `completed_date` (`min(finished_pallets.
   received_date)`, a "basically done" proxy 0086 needed since there was no real closure event)
   to `closed_at` (the actual booking event, now that one exists) — so "how much did we process
   this period" and "what did that processing lose" describe the exact same cohort of serials.
   Uses the identical AS-OF idiom (`(closed_at at time zone 'utc')::date between/< /<=`)
   `old_stock_closeouts` already established in these same two functions for a different closure
   concept — a historical point-in-time balance must ask "was this closed BY that date," never
   "is it closed right now," or re-running a past-dated report today would retroactively zero out
   material that was genuinely still open back then.
3. **Client-portal Moykada** — add a new Moykada figure to both `ClientHisobotTab.tsx` (new
   "Мойка" column, state totals) and `ClientSerialSummaryModal.tsx` (new "Мойка" row), not just
   let "Убыток" go blank. Both previously showed loss only, no in-process visibility at all.
4. **Natural-close mechanism** — a small follow-up RPC (`close_wash_cycle_if_settled`), called
   inline in `handleReceipt` right after the existing `finished_pallets` insert, not a trigger and
   not a single RPC wrapping the whole receive write. The real receive path is a plain client-
   side insert governed by a real RLS lab-verdict gate (`0076_rezka_data_layer.sql`'s `ombor_
   writes` policy); wrapping the whole write into one new `security definer` RPC would have meant
   re-implementing that exact gate a second time inside it — two places that must agree on who
   can pack a serial, a duplication risk this project's own conventions warn against. The chosen
   design keeps the existing insert (and its RLS gate) completely untouched and adds one small,
   internally-atomic follow-up call — a dropped connection between the two leaves a residual open
   (not lost), recoverable via Yakunlash, which is already the designed fallback.

**`wash_cycles.closed_at`, not `kirim_lines`.** Confirmed live via direct schema inspection
(CLAUDE.md) before choosing: `unique (serial)` on `wash_cycles` — genuinely 1:1 per serial today
(the old `cycle_no` column is gone entirely, dropped when Laborator v2 collapsed the wash-cycle
concept to one row per serial). `wash_cycles` is already the audit-trail home for closure-shaped
columns (`status`/`final_loss_pct`/`finalized_at`, the pre-cutover Tugallash record) — `closed_at`
is a direct sibling of that same family, not a new concept bolted onto `kirim_lines`' much wider,
unrelated scope. Its own unused `ombor_updates` UPDATE policy (unrestricted by column) was
dropped in the same migration, same precedent as `correct_kirim_line_tara`'s `storage_intake.
ombor_updates` drop — confirmed unused first (the only client write to `wash_cycles` today,
`OmborMoykaTab.tsx`'s upsert, uses `ignoreDuplicates: true`, insert-or-noop, never an actual
UPDATE) — `closed_at` now has exactly two write paths, both role-gated `security definer` RPCs,
never a table policy.

**`close_wash_cycle_serial`'s own "received" basis is deliberately the loosest of three that
coexist in this codebase**, flagged rather than silently unified (CLAUDE.md scope discipline):
`useMoykaOutput.ts` (frontend, only excludes `bekor_qilindi`) vs. `kirim_line_state`/
`client_calibre_split` (SQL, also excludes `storage_loss` and re-wash-consumed pallets — confirmed
identical to each other by direct comparison of both bodies). The RPC matches the FIRST, frontend
basis, since that's what Ombor is actually looking at on screen when confirming Yakunlash — the
residual it quotes in the confirm dialog must match what the RPC actually books. This means the
booked `yoqotishKg` can, in the rare case a storage-loss-voided or re-wash-consumed pallet exists
for that serial, differ slightly from what Hisobot/Yield/passport compute afterward on their own
basis. Not introduced by this prompt — the three bases already disagreed before Yakunlash
existed; unifying them is a separate, larger task.

**Verified live against real production data, not a local sandbox** (no Supabase branching on
this project's plan, same standing limitation as every prior prompt): applied the migration,
then `kirim_line_state('150826-001')` returned `moykada: 567` — the exact Isfara P3 figure the
task itself named, confirming the fix addresses the real motivating case directly. `yield_rows`
now returns 0 rows (expected — no serial has ever been closed, since `closed_at` was just added;
see "Immediate operational consequence" below). Confirmed via direct query that **zero** currently-
open serials already sit at a zero-or-negative balance (i.e., none would have silently
auto-qualified for closure under the old model) — every one of them genuinely needs either a
future receive or a manual Yakunlash to close. `get_client_report`'s mass-balance identity
(`balancesKg`) for the real Global Export owner, full history to date: **exactly 0** — this term
was deliberately left untouched (pure signed-sum algebra, confirmed never rendered anywhere in
`ClientReportTab.tsx` via direct grep before deciding not to touch it), so it balances exactly as
it did before this migration, by construction, not by re-verification alone.

**Immediate operational consequence, flagged prominently rather than discovered later:** because
there is no backfill and every currently-open serial (confirmed, all of them) still has a
residual today, `rahbar_dashboard_ledger`'s `moyka.processedKg`/`moyka.lossKg` (Ledger B) and the
entire Yield (Hosildorlik) tab will read **empty/zero for the whole history** the moment this
ships, until real closures start accumulating — verified live: `rahbar_dashboard_ledger`'s
`moykadaSnapshot.residualKg` (a diagnostic slack term, expected to read 0 when nothing distorts
the identity) currently reads 33,725 kg, entirely attributable to `processedKg` now correctly
excluding every serial that hasn't been closed yet under the new date basis (decision #2 above) —
not a bug, the direct, accepted cost of "no backfill, no guessed close-times." **Recommendation
for Abdulloh:** work through the existing backlog of open, lab-passed serials via the new
Yakunlash button soon after this ships, or Yield/Ledger B will stay visibly empty until each one
naturally closes on its own via a future receive (most won't get one — they're already fully
packed in every practical sense, just never formally closed).

**Verified:** `npx tsc --noEmit`, `npx oxlint`, `npm run build` all clean. `node --test`: 67/67
(7 new — 1 `isInMoyka` closed-serial case, 6 `computeLossDisplay` cases covering open/closed ×
loss/surplus/exact-match).

**Not run this session:** the task's own Playwright walkthrough (send/receive/Yakunlash/reprint
on `TEST-` fixtures) — same disclosed sandbox limitation as every prior prompt (no `.env.test`,
no real login session obtainable here). Flagged, not silently skipped. Whoever picks this up next
should run it against the deployed app: send 1000 kg, receive 500 then 400 (Moykada 100, dash),
Yakunlash (confirm quotes "100 kg", Moykada 0/Yo'qotish 100 after), confirm the serial drops off
the receive picker with no Yakunlash button left on its Window 2 row, reprint a Barcode #2 and
confirm the same value prints, and a natural-close case (receive exactly to zero, Yakunlash
button never appears, `closed_at` sets itself).

**Out of scope, untouched:** automatic/time-based close (explicitly ruled out by the task),
undo/reopen UI for a closed serial, Yakunlash for a serial without a lab-passed verdict (blocked
both client-side and inside the RPC), any change to Barcode #2's print mechanism or QR encoding.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/global-export-profile-setup-t1hl6t`.
