## 2026-08-14 — Ombor Moyka finalize: restore the lab-verdict hard gate on Tugallash

**Context:** Regression reported from the floor (screenshots, real serials `050826-001` 6,460 kg
and `290726-071` 1,912 kg): `OmborTayyorTab`'s only available action for a serial with no lab
verdict was `Tugallash`, whose confirm dialog showed `Yakuniy yo'qotish: 100.0%` — pressing it
would deregister the serial and lock in a fabricated total-loss figure with zero legitimate
basis, since with no verdict `received` can only ever be 0.

**Root cause, found via `git log`, two commits that individually made sense but were never
reconciled:**
- `002a9c3` (2026-07-16, "Make Tayyor finishing manual-only") removed Tugallash's *only* gate
  at the time (`disabled={pallets.length===0}`), replacing it with a non-blocking soft warning.
  Correct for its stated purpose — a broken auto-finalize-on-quantity-match trigger had already
  corrupted one real serial's loss figure in production (`140726-002`), and the fix's own
  reasoning ("the operator decides when it's done, not a quantity threshold") is sound and is
  **not** reversed here.
- `d85664d` (2026-07-28, "Laborator v2: lab moves inside Moyka") added a genuine hard gate —
  packing (`finished_pallets` INSERT / Barcode #2 assignment) now requires the serial's latest
  CHIQIM verdict to be `o_tdi`, enforced by RLS (`ombor_writes` on `finished_pallets`,
  `0035_lab_relocation_core.sql`). This commit never revisited Tugallash, which still had no
  gate at all after `002a9c3`. The two changes compound: receiving became correctly blocked
  without a verdict, but finishing did not — so a serial could be blocked from ever receiving
  real output while remaining fully finishable at a fabricated 100% loss, through the only
  button the card offered. `docs/SPEC.md` §5.3 still read "Tugallash is always clickable,
  never disabled by any quantity" verbatim after `d85664d` — the two sections were never
  reconciled. Amended in this pass (struck, not deleted, per CLAUDE.md).

**Production data checked, none found damaged.** Queried every `wash_cycles` row with
`status='final'` joined to real (non-`TEST-`, non-`opening_stock`-origin) owners: **zero
rows** — no real serial has ever been finalized via `wash_cycles.status='final'` at all
(the only `final` rows in the table are the five pre-seeded opening-stock serials, backdated
`finalized_at=2025-01-01`, a structurally different case, unaffected). The two serials in the
bug report (`050826-001`, `290726-071`) are currently sent to Moyka with no lab verdict and
**not yet finalized** — at risk, not damaged. No production data was modified.

**Decision — frontend (applied):**
- `OmborTayyorTab.tsx`: while `labStatus !== 'passed'`, the card renders only the explanatory
  `StatusNote` — no Tugallash button, no path to any action. Text now names both blocked
  actions ("qabul qilish va tugallash uchun... kerak") rather than only receiving, since both
  are now blocked for the identical reason. Once `labStatus === 'passed'`, both `+ Qabul
  qilish` and `Tugallash` return exactly as before `002a9c3`/`d85664d` — including the
  existing non-blocking soft warning (raw remainder / loss > 10%) on confirm, untouched.
- `handleTugallash` gained a defensive `labStatus !== 'passed'` guard before the write (same
  shape as `handleReceipt`'s existing reliance on its RLS gate) — unreachable via the UI now,
  pure defense in depth.
- `SPEC.md` §5.3 amended in place (struck, not deleted) to state the exception; §5.5.3's hard
  gate text is unchanged, already correct.

**Decision — server-side (applied, `wash_cycles_finalize_lab_gate`).** `wash_cycles` had an
`ombor_updates` UPDATE policy with `with_check` `null` — nothing stopped an `ombor`-role client
from setting `status='final'` on a serial with no passing verdict via a direct API call,
bypassing the UI entirely. Four things checked before writing the policy, per direct
instruction, since a blanket verdict requirement could otherwise permanently block a
legitimately-verdict-less path:

1. **Rezka.** `mint_serial_from_sources` (`0055_mint_serial_rpc.sql`) — the function Rezka is
   documented to reuse unchanged (see the 2026-08-02 "Opening stock, Stage 3" entry: "Rezka
   calls it unchanged and sends its serial to cutting instead") — never references
   `wash_cycles` at all. Only `send_old_stock_to_moyka`, an explicitly separate Moyka-only
   wrapper, does the `wash_cycles` upsert. So a Rezka-cut serial cannot acquire a `wash_cycles`
   row via any currently-planned path; nothing in the schema needs to distinguish wash from
   cut on this table today. Not adding a `process_kind` column now — that would pre-guess a
   design Rezka hasn't made yet, and would work against the deliberate mint/wrapper split this
   codebase already built specifically to keep Rezka Moyka-free. Flagged instead, same pattern
   as `raw_dispatch_lines.serial`'s FK (2026-07-31 entry): if Rezka's own completion-tracking
   design ever reuses `wash_cycles`, this policy's verdict check must be revisited then, or a
   cut serial (which will never have a passing CHIQIM verdict) would be permanently
   unfinalizable.
2. **Raw dispatch.** Grepped every INSERT/UPDATE/UPSERT against `wash_cycles` across all
   migrations and all frontend files — nothing in the raw-dispatch path
   (`raw_dispatch_lines`/`chiqim_line_raw_serials`) appears. Matches SPEC.md's own text: raw
   never enters processing, so it never reaches the lab gate in the first place.
3. **Mint path + opening-stock seeds.** `mint_serial_from_sources` never touches `wash_cycles`
   (above). `send_old_stock_to_moyka` inserts `status='active'` only, never `'final'`. The five
   backdated seed rows (`0048_opening_stock_stage1_seed.sql:772`) were written once, directly,
   inside a migration script (bypasses RLS entirely; already ran; won't re-run). Nothing
   re-updates them: `OmborMoykaTab.handleSend`'s upsert uses `ignoreDuplicates: true` (a true
   no-op against an existing row), and `OmborTayyorTab.handleTugallash` — the one site that
   could — is structurally unreachable for them (`sent_kg=0`, already `finalized=true`, so
   `isAwaitingTugallash` excludes them from Window 1 entirely).
4. **Security-definer RPCs under another role.** `send_old_stock_to_moyka` is the only one
   writing `wash_cycles`, always invoked as `ombor` (checked in its own body via `my_role()`).
   Caveat stated plainly: RLS does not apply inside `security definer` function bodies at all —
   this gate protects real client sessions and direct API calls under the `ombor` role (the
   actual bug scenario), not a hypothetical future security-definer RPC. Identical scope to the
   existing `finished_pallets` gate and every other RLS policy in this schema — not a new
   weakness.

All four confirmed with the user before applying. Mirrors `finished_pallets`' `ombor_writes`
gate exactly, restricted to the finalizing transition only — any non-final update (the
first-send `status='active'` upsert, or anything a future Rezka path would do) is untouched:

```sql
drop policy ombor_updates on wash_cycles;
create policy ombor_updates on wash_cycles for update
  using (my_role() = 'ombor')
  with check (
    my_role() = 'ombor'
    and (
      status != 'final'
      or (
        select lr.verdict from lab_results lr
        where lr.wash_cycle_id = wash_cycles.id and lr.scope = 'chiqim'
        order by lr.created_at desc limit 1
      ) = 'o_tdi'
    )
  );
```

**Testing, round 1 (UI-level, before the RLS migration).** Disposable fixture, two serials
under one `TEST-`-owner (non-`TEST-` plates `01A901TG`/`01A902TG`), sent to Moyka, no verdict.
Confirmed live in the browser (real Ombor login) against both fixture serials *and* the two
real at-risk production serials simultaneously: (1) no verdict → Tugallash absent, reason
legible, for all four; (2) inserted a passing `lab_results` row for fixture serial 1 → `+ Qabul
qilish` and `Tugallash` both reappeared for it alone, the other three unchanged; received a real
700 kg pallet through `FinishedReceiptForm` (Barcode #2 `PLT-130826-001-06-1` generated,
printable), then Tugallash → confirm dialog showed `Yakuniy yo'qotish: 300 kg · 30.0%` (real
figure, not fabricated), `Ha, tugallash` → `wash_cycles.final_loss_pct = 30`, serial correctly
moved to Window 2 (`-30.0%` badge); (3) passed verdict on fixture serial 2, Tugallash with 0
received → confirm dialog showed `500 kg · 100.0%` with the existing soft warning, `Ha,
tugallash` → `final_loss_pct = 100`. Fixture fully removed, reverified at zero rows.
`npx tsc -b --noEmit` and `npm run lint` clean throughout.

**Testing, round 2 (RLS-level, after applying the migration).** A fresh disposable fixture
(`TEST — wash_cycles RLS gate verification`, serials `130826-003`/`130826-004`, plates
`01A903RG`/`01A904RG`), sent to Moyka, no verdict. From a real, logged-in Ombor browser session,
called `window.supabase.from('wash_cycles').update({status:'final', ...}).eq('serial',
'130826-003')` directly — bypassing the app's UI entirely, exercising the real PostgREST
endpoint with the real `ombor` JWT (`window.supabase` is exposed in dev builds specifically for
this, see `src/lib/supabase.ts`). **Rejected**: `{code: "42501", message: "new row violates
row-level security policy for table \"wash_cycles\""}` — confirmed via direct query afterward
that the row was untouched (`status='active'`, `final_loss_pct=null`). Then gave the fixture a
passing verdict and repeated the full normal-finalize flow through the real UI end to end: 600
kg received (Barcode #2 `PLT-130826-003-06-1`), Tugallash confirm showed `200 kg · 25.0%`,
confirmed → `wash_cycles.final_loss_pct = 25` — this time a real, RLS-permitted write. A second
fixture line (`130826-004`, 300 kg sent, passing verdict, 0 received) confirmed the deliberate
total-loss path still works under the new gate: confirm dialog showed `300 kg · 100.0%`,
confirmed → `final_loss_pct = 100`. Fixture fully removed afterward (owner, 2 orders/lines/
intakes/gate-weighings/sends/cycles/pallets/lab-results), reverified at zero rows. Re-queried
production one final time: `050826-001` and `290726-071` both still `status='active'`,
`final_loss_pct=null`, no verdict — untouched throughout every test in both rounds. Zero real
(non-`TEST-`, non-`opening_stock`-origin) `wash_cycles` rows with `status='final'` exist
anywhere in the database.

**Out of scope, not touched:** Rezka implementation, KN origin tracking.
