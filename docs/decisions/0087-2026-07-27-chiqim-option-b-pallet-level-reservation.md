## 2026-07-27 — CHIQIM Option B: pallet-level reservation

**Context:** Option A (2026-07-24, "CHIQIM inline pallet picker") was explicitly non-reserving — the picker helped Menejer calculate a kg target by clicking real pallets, but `chiqim_lines` stored only the number, and any matching pallet at scan time would do. This closes the deferred gap: requests now target specific pallets, Ombor gets a concrete prepare-list, and reservation prevents double-claiming.

**Inspected and reported before coding, per the task's gate — three real gaps found, all confirmed live, not assumed:**
- `chiqim_lines` had no pallet-reference column of any kind (`id, request_id, type_id, calibre_id, qty_kg` only, confirmed via `information_schema.columns`).
- `chiqim_requests` had **no void mechanism and no Menejer UPDATE policy at all** (`menejer_writes` INSERT, `read_all` SELECT, `ombor_updates` UPDATE — confirmed via `pg_policies`). Requirement 4's "freed on request completion or void" and the task's own testing script ("void the request") aren't buildable without first closing this — flagged explicitly rather than building around it, per the task's own "flag any conflict with the append-only/void rules" instruction. Proposed a `voided_at`/`voided_by` column pair (mirrors `wash_cycles.voided_at`, not a new `order_status` enum value — that enum is shared with `kirim_orders`, out of scope to touch) plus a Menejer UPDATE policy scoped to `ombor_finished_at IS NULL` (voiding a request already mid-scan needs a real `dispatch_manifest` unwind, a separate, bigger concern).
- `resolveScan`'s existing type+calibre "largest remaining gap" heuristic (for two lines sharing the same type+calibre) becomes unnecessary once every pallet is reserved to a specific line — confirmed by reading the current logic, not assumed obsolete.

Presented the full schema (below) and three judgment calls in chat, waited for confirmation before writing any SQL: (1) add the void mechanism as proposed, (2) disable manual qty-typing once matching pallets exist — picker becomes the only path, manual typing stays only for the pre-existing zero-pallets fallback, (3) retire the old gap-heuristic in favor of direct reservation lookup. All three confirmed.

**Schema (`0033_chiqim_pallet_reservations.sql`), applied live and as a migration file:**
```sql
alter table chiqim_requests add column voided_at timestamptz;
alter table chiqim_requests add column voided_by uuid references profiles(id);

create policy menejer_voids on chiqim_requests for update
  using (my_role() = 'menejer' and ombor_finished_at is null)
  with check (my_role() = 'menejer' and ombor_finished_at is null);

create table chiqim_line_pallets (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references chiqim_lines(id) on delete cascade,
  barcode2 text not null references finished_pallets(barcode2),
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index on chiqim_line_pallets(barcode2) where released_at is null;
create index on chiqim_line_pallets(line_id);
create unique index chiqim_line_pallets_active_barcode
  on chiqim_line_pallets(barcode2) where released_at is null;

alter table chiqim_line_pallets enable row level security;
create policy read_all on chiqim_line_pallets for select using (auth.uid() is not null);
create policy menejer_writes on chiqim_line_pallets for insert with check (my_role() = 'menejer');

create or replace function release_chiqim_reservations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.voided_at is not null and old.voided_at is null)
     or (new.ombor_finished_at is not null and old.ombor_finished_at is null) then
    update chiqim_line_pallets set released_at = now()
    where released_at is null and line_id in (select id from chiqim_lines where request_id = new.id);
  end if;
  return new;
end;
$$;
create trigger chiqim_requests_release_reservations
  after update on chiqim_requests for each row execute function release_chiqim_reservations();
```
`barcode2 references finished_pallets(barcode2)` is valid — `barcode2` IS `finished_pallets`' own primary key (confirmed via `pg_constraint`, same FK shape `dispatch_manifest.barcode2` already uses). `released_at is null` is "currently reserved," derived and enforced by the trigger — never written by client code, same pattern `complete_chiqim_stage2()` already established. The partial unique index is the actual double-claim guard, same strength as `dispatch_manifest.barcode2 UNIQUE` for the existing scan-claim mechanism, just releasable (append-only: released rows stay for history, never deleted).

**Exactly when reservation locks and releases:**
- **Locks** at request creation, in the same `handleSubmit` that already inserts `chiqim_lines` — sequentially, not batched, specifically so each row's own DB-returned `id` correctly ties its own picker selections to the right line (relying on batch-insert `RETURNING` order matching input order wasn't worth trusting for a mapping this load-bearing — a mismatch would silently reserve pallets under the wrong line).
- **Releases** via the trigger the instant `voided_at` OR `ombor_finished_at` transitions to non-null — completion releases too, not just voiding, because `dispatch_manifest` has already taken over as the real claim by then; an unscanned reserved pallet (a shortfall line) shouldn't stay locked forever just because the request finished anyway (§5.4's "never blocks").

**Implementation:**
- **`chiqimScan.ts`** — `resolveScan` no longer takes `lines`/`scannedTotalsByLineId` for matching; takes `reservedLineIdByBarcode: Record<string, string>` instead, built by the caller from data already loaded (no extra query). `no_matching_line` replaced by `not_reserved` — a valid, in-stock, lab-passed, unclaimed pallet is now rejected outright if it isn't reserved for this request, even if its type/calibre would otherwise match a line. `chiqimScan.test.ts` rewritten to match: the old "duplicate type+calibre lines, largest gap wins" test now proves the opposite — reservation resolves the line directly regardless of either line's gap.
- **`ChiqimForm.tsx`** — the qty `TextInput` is `readOnly` whenever `matchingPallets(row).length > 0`; manual typing survives only as the pre-existing zero-pallets fallback. Submit validates every row with real stock actually has a selection (a stock-existed-when-typed-then-got-claimed race, not the normal path). `handleSubmit` inserts lines sequentially, then batch-inserts `chiqim_line_pallets`, with a `23505` (active-reservation race) caught and given the same friendly-message treatment `OmborChiqimTab.tsx`'s own `dispatch_manifest` 23505 handling already uses. Requirement 5 (interchangeable stock, "no special-casing") needed no separate implementation — it falls directly out of the picker becoming mandatory: Menejer clicking "any 3 of 16" already produces 3 named pallets, the same interaction as always, just now persisted.
- **`useAvailableFinishedStock.ts`** — new shared `useReservedPalletBarcodes.ts` hook (`chiqim_line_pallets` where `released_at is null`), excluded here alongside the existing `dispatch_manifest`/lab-status filters, and reused by `ChiqimForm.tsx`'s own `matchingPallets()` so the feasibility hint and the picker can never disagree about what's reserved — same "one derived truth" reasoning `currentCycleLabStatus` already established.
- **`useOmborChiqimRequests.ts`** — query now nests `chiqim_lines(...).chiqim_line_pallets(barcode2, finished_pallets(serial, weight_kg))`, three levels, the prepare-list's actual data. Also added `.is('voided_at', null)` — voided requests never reach Ombor at all (voiding is only allowed pre-scan, so Ombor never had a reason to see one).
- **`OmborChiqimTab.tsx`** — new "Yig'ish kerak — palletlar" section, shown immediately on expand (right after target progress, before the scan zone — the task's own "not a hidden detail," not buried behind a second toggle), one sub-list per line, already-scanned pallets get a checkmark/strikethrough so it reads as a live "what's left" list. `processBarcode` derives `reservedLineIdByBarcode` from `request.lines` (already loaded, no extra query) and passes it to `resolveScan`; the `finished_pallets` select dropped `type_id`/`calibre_id` (no longer needed once reservation replaced type/calibre matching).
- **`useFinishedChiqimRequests.ts`/`FinishedChiqimList.tsx`** — void action, scoped to exactly what `menejer_voids`' RLS allows (`!request.voided_at && !request.ombor_finished_at`), same two-step confirm shape as `OmborChiqimTab.tsx`'s own `Yuklashni yakunlash` (not a browser `confirm()`). A voided request stays visible with a new "Bekor qilindi" pill — this app's void-don't-delete convention, unlike Ombor's window, which excludes voided requests outright.

**Verified live, real end-to-end, exactly the task's own testing script:**
- Reserved two real pallets (`PLT-210726-009-04-1` 1,000kg + `PLT-210726-009-04-3` 100kg, Samarqand Meva Kompaniyasi/Subxon/Kalibr 4) via the picker — qty auto-filled `1100`, field confirmed `readOnly: true`. Saved successfully, appeared immediately in Menejer's own list as `Kutilmoqda`.
- Logged in as Ombor: the prepare-list showed exactly those 2 pallets (barcode/serial/weight), nothing else.
- Manual-entry scanned one listed pallet → accepted, progress bar `100/1,100`, prepare-list marked it `✓` struck-through. Scanned a different, genuinely valid (in-stock, unclaimed, lab-passed) pallet not on the list → rejected with `"Bu pallet bu so'rovga tegishli emas."` — the exact message requested.
- Logged back in as Menejer, re-opened the picker for the same owner/type/calibre → **zero** pallets offered (`"Bu buyurtmachida ushbu tur/kalibrda mavjud pallet yo'q."`), confirming both reservations correctly excluded a second request's availability while the first stayed open.
- Voided the first request (two-step confirm) → pill flipped to `Bekor qilindi`. Reloaded and reopened the picker for the same combination → **both pallets available again**, confirming the release trigger fired correctly on `voided_at`.

**A real e2e consequence, expected once manual typing became conditional — but chasing it down surfaced two genuine bugs, not just fixture churn.** Three specs filled the CHIQIM qty input directly (`chiqim-undo-scan.spec.ts` ×2, `full-chain.spec.ts` ×1) for scenarios where real matching stock exists at that point, making the field `readOnly` and `.fill()` throw. The obvious fix — click the picker instead — immediately surfaced something worse:

**🚩 Real bug #1, found live, not hypothetical: a line with zero reservations became permanently unscannable.** `full-chain.spec.ts`'s own CHIQIM-side KIRIM order used `uniqueTestId(...)` (`TEST-`-prefixed) — and `stock_on_hand_rows` (the picker's own data source) turned out to carry a **third** filter excluding any pallet whose parent `kirim_orders.plate` starts with `TEST-`, the same family as `useFinishedChiqimRequests.ts`/`reportQuery.ts`'s `isTestPlate()` (see `fixtures.ts`'s own `uniqueRealLookingPlate` doc) but never previously documented for this view. So the picker offered *nothing* for the fixture's own freshly-produced pallet, my "click the only PLT- button" locator matched a *different*, unrelated already-visible pallet instead, and the target silently became wrong. Root-caused via the view's actual `pg_get_viewdef` output, not guessed. Fixed at the fixture level: `seedDispatchablePallets`'s plate and `full-chain.spec.ts`'s `PLATE_IN` both switched to `uniqueRealLookingPlate()` (zero other assertions depended on either being `TEST-`-prefixed, checked directly before changing). Picker clicks also switched from a generic "any PLT- button" match to the test's own already-known barcode variable, so a genuine accumulated/unrelated pallet can never be clicked by mistake again.

**🚩 Real bug #2, more fundamental — found via `rewash-hard-gate.spec.ts`'s own scenario, not invented to make a test pass.** That test scans a cycle-2 pallet — produced *after* the request existed — into a request whose line had zero reservations at creation time (the gated cycle-1 stock was correctly invisible). Under the original "reservation is unconditionally authoritative" design, that line could *never* accept anything, ever — not just in this test, but for any real request created before its target stock existed (ordering ahead of production is exactly what the zero-pallets manual-typing fallback is *for*). Fixed in `chiqimScan.ts`: `resolveScan` now checks a pallet's own reservation first (authoritative when present), and only for a line with **zero reservations at all** falls back to Option A's original type/calibre matching (largest remaining gap) — a line that has *any* reservation never falls back, even for an unreserved-but-matching pallet, keeping requirement 3's exclusivity intact. `chiqimScan.test.ts` gained dedicated coverage for both the fallback itself and its interaction with a sibling line that *does* have a reservation. `OmborChiqimTab.tsx`'s `processBarcode` restored `type_id`/`calibre_id` to the pallet lookup and passes `lines`/`scannedTotalsByLineId` back through, both needed by the fallback.

With that fixed, `rewash-hard-gate.spec.ts` itself needed two further changes: its own KIRIM plate switched to `uniqueRealLookingPlate()` (so cycle 2's pallet would be picker-visible), and its "confirm dispatchable" step was redesigned to build a **fresh** request through the normal reserve-then-scan flow rather than reusing the earlier gate-check request via the fallback — a more faithful exercise of Option B's primary path, and independent of whichever request the fallback-based analysis above concerned. Its Direction-1 assertion (`/eng yaqin: 0 kg/`) was also replaced — not patched — with a direct check that the specific gated barcode is never offered by the picker: the old text assertion was fragile against this shared e2e database's own accumulated, unrelated stock (confirmed live: a real 600kg pallet from earlier in this session legitimately makes `nearestBelow` nonzero, which is `checkFeasibility` working correctly against real data, not a bug) — this is the same class of drift already flagged 3× for this exact file's line 206 assertion in earlier entries, now actually resolved for this specific check rather than re-flagged a 4th time.

**Verification.** `npx tsc -b --noEmit` and `npx oxlint` clean (same 3 pre-existing warnings, none new). Unit suite 82/82 (net +3: 2 removed for the retired gap-heuristic, 5 added covering reservation-authoritative matching, the zero-reservation fallback, and their interaction). Full Playwright suite, final run: **4/4 passed**, including `rewash-hard-gate.spec.ts` clean.

**Out of scope, not touched (per the task):** opening-stock seeding, the cut line, moisture-based selection, the raw/KIRIM side, `chiqimFeasibility.ts`'s own subset-sum logic (still soft-warning only, unchanged).
