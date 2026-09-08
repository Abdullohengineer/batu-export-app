## 2026-08-28 — Moyka loss becomes live; remove Tugallash

**Prompt:** replace the "one `wash_cycles` row per serial, `Tugallash` locks `final_loss_pct`"
model with a live, continuously-computed, signed per-serial balance — `loss = moyka_sends.qty −
finished_pallets.qty`, always, for every serial with `sent > 0`, recomputed on every read. No
user action ever closes a serial; `Tugallash` (button, handler, §5.3 Window 2/"Tugallangan") is
removed entirely. Hard gate in the brief: full read-path inventory + proposed migration SQL shown
in one message, confirmed before any code/migration touched — see that message for the complete
current-vs-new SQL/TS per site.

**Three premises in the brief were checked against the schema/codebase and found wrong — reported
back before designing anything, per this file's own "stop, report, do not invent a design" rule:**
1. `finished_pallets.parent_serial_id` does not exist. The only serial link is the pre-existing
   `finished_pallets.serial` (text) → `kirim_lines.serial` FK, already what every read path uses.
2. `wash_cycles.status` is a plain `text` column (`not null default 'active'`), not a Postgres
   enum — no `ALTER TYPE`, no enum-value question, anywhere in this change.
3. `computeSignedLossPct` did not exist — only the floored `computeFinalLossPct` did. No TS-side
   signed-loss helper was needed in the end: every consumer that needs the live figure now reads
   it from SQL (`client_serial_loss_kg`, `yield_rows.loss_kg`, `get_serial_passport`'s
   `cycles[].lossKg`), and Ombor's own UI no longer displays a loss number at all (see below) —
   `computeFinalLossPct`/`completionBadge`/`tugallashWarnings` were deleted outright, not replaced.

A fourth check, not in the brief: migration numbering was audited (`list_migrations` vs. local
`supabase/migrations/`) and found to have **no drift** — 85 local files map 1:1 in order to the
live migration history, including 0072/0073.

**Five design calls, made by the user after the site inventory (not invented):**
1. `yield_rows` scope widens from "only finalized" to every serial with `sent > 0` — a still-
   packing serial now shows a live, updating figure instead of being absent until Tugallash.
2. §5.3 Window 2 ("Tugallangan") is dropped outright, not redefined by another criterion. Window 1
   becomes the tab's only window, filtered to a positive live in-Moyka balance (`isInMoyka`); a
   serial disappears on its own once packing catches up. The interim shape isn't worth building
   since the section 3 UI redesign (a later prompt) replaces this tab's whole layout anyway.
3. `wip_rows.moyka_not_returned` switches from `wash_cycles.status='active'` to a live balance —
   `wash_cycles` becomes lab-linkage-only (see #4).
4. `wash_cycles.status`/`final_loss_pct`/`finalized_at` — columns kept, historical `'final'` rows
   never mutated (an audit trail of pre-cutover Tugallash actions, matching the void-not-delete
   convention), but the app never writes `'final'` again and no read path branches on `status`.
   No `ALTER`, no `DROP` (moot anyway per correction #2 above).
5. `SerialPassportModal.tsx`'s Yakunlangan/Faol badge is replaced with two live numbers —
   "Moykada: X kg" (floored, physical) and "Yo'qotish: Y kg" (signed) — rather than kept or
   repointed at a proxy.

**One further call, surfaced only once the SQL was drafted (not in the original five):** the old
model kept "moykada" (WIP, floored ≥0) and "loss" (locked at Tugallash) mutually exclusive per
serial by construction, so `get_client_report`'s `balancesKg` mass-balance identity could sum
both safely. Under the live model they're the *same* magnitude for a still-open serial — summing
both would double-count. Resolved (user's explicit pick, offered as two options): **loss absorbs
the identity term** — `cumulative_loss_total` becomes the sole ledger contribution (signed,
unconditional), `moykadaKg` stays in the JSON as a **display-only** alias (still its own floored,
per-line sum — not `greatest(0, cumulativeLoss)`, since summing-then-flooring and flooring-then-
summing differ whenever some lines are net-negative) and is no longer subtracted a second time in
`balancesKg`. Verified live post-migration: `get_client_report`'s `balancesKg` for the real Global
Export owner over 2026-01-01..2026-08-28 returns exactly `0`.

**Migration `supabase/migrations/0086_moyka_loss_live_remove_tugallash.sql`** (applied live,
`qohoqbapevrcjqxbstxi`) — 8 objects:
- `yield_rows` (view): `finished_serials` filter `wash_cycle_status='final'` → `raw_consumed_kg >
  0`; `output` CTE's join to `finished_pallets`/`calibres` switched from inner to left + `group
  by`, so a serial with zero pallets so far still produces one row (`output_kg=0`,
  `loss_kg=raw_consumed_kg` — fully open, reads as 100%, exactly the live model's point).
- `get_client_report`: `moykada_total`/`moykada_by_type` unconditional (drop the finalization
  case, keep the floor); `loss_totals` scoped by `completed_date` alone (drop the
  `wash_cycle_status`/`finalized_at` gate); `cumulative_loss_total` signed and unconditional, now
  the sole `balancesKg` ledger term (see above); `client_lines`' dead `wash_cycle_status`/
  `finalized_at` selects dropped (`wash_cycle_id` kept — still needed for `quality_record`'s lab
  join).
- `rahbar_dashboard_ledger`: `moyka_in_process`/`moyka_opening_total` unconditional (display-only,
  same as `moykadaKg` above — no double-count risk here since this function's own
  `moyka_identity_residual` never summed loss and WIP together in the first place);
  `processed_lines` drops its `wc.status='final'` gate, scoped by `completed_date` alone, same
  treatment as `get_client_report`'s `loss_totals`; its own now-unused `wash_cycles` join dropped.
- `rahbar_stock_snapshot`: `moykada_total` unconditional, `wash_cycles` join dropped entirely
  (was only feeding the removed gate).
- `wip_rows`: `moyka_not_returned` rewritten to reuse `kirim_line_state()` (`kls.moykada > 0`)
  instead of `wash_cycles.status='active'` — reuse, not reimplement (CLAUDE.md). Necessary beyond
  a mechanical rename: without a "still has a positive live balance" filter, a fully-packed serial
  sent long ago would alert here forever, since nothing ever flips `status` away from `'active'`
  any more. `awaiting_lab`/`so2_pending` untouched — genuine lab-linkage uses.
- `client_serial_loss_kg`: fully rewritten — signed, unconditional, no `wash_cycles` reference at
  all. Never returns `null` any more (`client_report_rows`/`client_report_totals`/
  `client_serial_summary` all consume it, so their loss figures went live with no further SQL
  change needed).
- `client_serial_summary`: drops the now-dead `washCycleStatus` field (confirmed unused by
  `ClientSerialSummaryModal.tsx` before removing it).
- `get_serial_passport`: `cycles[]`'s `status`/`finalLossPct` → `inMoykaKg`
  (`greatest(0, sent−returned)`) / `lossKg` (`sent−returned`, signed). Everything else in this
  large function is byte-for-byte unchanged.

Live verification post-apply (real data, `qohoqbapevrcjqxbstxi`): `yield_rows` now surfaces
`180826-001` (7,960kg sent, 0 pallets yet, `loss_kg=7960`, `loss_pct=100.0`) — invisible under the
old filter. `client_serial_loss_kg` returns a real signed number (including negative — the six
serials corrected the prior session, e.g. `290726-072: loss_kg=-2280`) for every sent serial,
zero-pallet ones included. `wip_rows.moyka_not_returned` returns rows with no error, `kls.moykada`
gate confirmed working. `get_serial_passport('150826-001')` returns `cycles[0] =
{inMoykaKg: 7947, lossKg: 7947, sentKg: 7947, ...}`, no `status` field. `get_client_report`'s
`balancesKg` = `0` exactly for the real Global Export owner (see above).

**Frontend:**
- `src/lib/useMoykaOutput.ts`: dropped the `wash_cycles` fetch, `CompletedSerial`/`completed`/
  `finalCycleBySerial`/`lossPctBySerial`/`finalizedAtBySerial`/`completedSerials`; `activeSerials`
  now filters on `isInMoyka(sent, received)`.
- `src/pages/ombor/OmborTayyorTab.tsx`: `handleTugallash`, the Tugallash button/confirm panel, and
  the whole Window 2 (Tugallangan) section removed. No loss/percentage display added in their
  place — decision #2 explicitly moves historical loss to reports/passport, not this screen.
- `src/lib/tayyorCompletion.ts`: `computeFinalLossPct`/`completionBadge`/`CompletionBadge`/
  `tugallashWarnings`/`TugallashWarningReason` deleted (kept `jarayonda`/`ortiqcha`, both still
  correct and used).
- `src/lib/stageMembership.ts`: `isAwaitingTugallash(sent, finalized)` → `isInMoyka(sent,
  received)` — same shared-predicate role (§5.2 W2 = §5.3's only window), new signature since
  there's no `finalized` flag to read any more.
- `src/pages/ombor/OmborMoykaTab.tsx`: no functional change (Window 2 already reused
  `useMoykaOutput().serials` directly, so it inherits the new filter automatically) — comments
  updated only. `handleSend`'s `wash_cycles` upsert kept (still mints the row lab needs).
- `src/lib/serialPassport.ts` / `SerialPassportModal.tsx`: `PassportCycle.status`/`finalLossPct` →
  `inMoykaKg`/`lossKg`; badge replaced per decision #5 (loss red when positive, amber `+Nkg` when
  negative/overage, slate at exactly 0).
- `src/lib/clientPortalReport.ts` / `ClientSerialSummaryModal.tsx`: `washCycleStatus` field
  dropped from the client-portal type/RPC mapping; `ClientSerialSummary.lossKg`/
  `ClientReportTotals.ubytokSerialCount` comments updated (no longer "null until finished" —
  `ubytokKg` on report rows stays nullable only for the no-serial case, e.g. `chiqim_old_kn`); the
  modal's dead `lossKg === null` branch removed (the type no longer allows it).
- Two e2e specs exercised the removed Tugallash flow and were adapted, not deleted:
  `tests/e2e/lab-relocation-loss-verification.spec.ts` drops the Tugallash click/confirm-dialog
  check (the same 150kg/15.0% assertion now reads straight off the packed pallet, no action
  needed); `tests/e2e/full-chain.spec.ts` replaces its Tugallash-then-check-Tugallangan block with
  a direct `yield_rows` read for the same 400kg/8.0% figure, taken while the serial still sits in
  Window 1 (400 of its 5,000kg sent is still unpacked) — proving the number is live, not gated on
  finishing packing. A few unrelated comments elsewhere (`OmborChiqimTab.tsx`, `ChiqimForm.tsx`,
  `useLaboratorChiqim.ts`, `chiqimScan.ts`) still cite old Tugallash-based philosophy as rhetorical
  precedent for an unrelated CHIQIM-side soft-warning pattern — left as-is, out of scope.

**Verified:** `npx tsc -b --noEmit` clean; full `node --test` suite (72 tests, including the two
rewritten `tayyorCompletion.test.ts`/`stageMembership.test.ts` files) passes; `npx oxlint` clean
on every touched file; `npm run build` succeeds. No live-browser Playwright run this session (same
network-policy limitation as the client-portal work — `*.supabase.co` blocked from this
environment's Chromium) — the two adapted e2e specs are updated for correctness but not run.

SPEC.md §5 intro (windows table, "Placement windows vs. acceptance windows", the now-removed
"Finishing is always manual" named invariant) and §5.3 amended inline (struck old text, not
deleted, per this file's own convention) rather than rewritten wholesale.
