## 2026-08-16 — Rezka data layer: partial-send fix folded into stage 1, decisions 1-5 resolved, migration-history audit

**Context.** Second round on the same design, same day, still not applied — resolving the five
"decisions needed before stage 2" the entry above closed with, plus two items raised directly:
fold the partial-send gap into stage 1 (stock integrity, not cosmetic), ship the passport
`sentWeighedKg` fix separately/first, and reconcile the migration-history record properly (the
`wash_cycles_finalize_lab_gate` gap above being one of at least two known instances of the same
failure mode). Still read/design only for the Rezka migration itself: exact SQL dry-run-verified
against production inside a single rolled-back transaction, nothing applied for real.

**Decision 1 resolved — the partial-send gap, exhaustively enumerated, not just the one instance
already flagged.** Grepped every `moyka_sends` reference in the live schema and classified each as
a real balance subtraction (at risk) vs. a movement/display read (not at risk) vs. gated on
`wash_cycles.status = 'final'` (structurally immune — a Rezka serial never acquires a `wash_cycles`
row, per the dual-process trigger the prior entry already established). Nine sites needed the same
treatment — add a `rezka_sends` lateral/subquery alongside the existing `moyka_sends` one, reusing
each site's own existing sum pattern, no new balance arithmetic invented anywhere:
1. `stock_on_hand_rows.raw_rows` — the raw-remaining bucket itself.
2. `get_client_report.client_lines` — `rezka_sent_before_from_kg`/`rezka_sent_as_of_to_kg` added,
   used in `raw_opening_total`/`raw_closing_total`/`raw_opening_by_type`/`raw_closing_by_type`.
3. `close_out_old_stock`'s `old_raw` branch — a **permanent write** into
   `old_stock_closeouts.book_remaining_kg`, not just a read.
4. `old_stock_closeout_lines.old_raw_lines` — the read-side mirror of the same closeout figure.
5. `rahbar_dashboard_ledger.lines` — same pair as `get_client_report`, used in
   `raw_opening_total`/`raw_closing_total`.
6. `wip_rows.raw_not_sent` — the WIP idle-raw bucket.
7. `correct_kirim_line_tara.new_available_kg` — the tara-correction RPC's own recomputed balance.
8. `kirim_line_state.omborda_qoldi` — Hisobot's per-serial state breakdown.
9. `get_serial_passport.raw_storage_loss` — the old-stock storage-loss estimate for a still-open
   raw line.

Investigated and ruled OUT, not assumed safe: every `sum(...) filter`/aggregate reachable only
through a `wash_cycles.status = 'final'` gate (`rahbar_dashboard_ledger.processed_konditirskiy_total`
i.e. Ledger B, `get_client_report.loss_totals`, `yield_rows.raw_consumed_kg`) — same immunity
argument as the calibre-separation aggregates in the entry above, re-verified for this specific
concern rather than assumed to carry over.

**Two related gaps found and deliberately NOT fixed, flagged instead of silently patched or
silently ignored:**
- The over-send **detector** in `get_client_report`/`rahbar_dashboard_ledger`
  (`sent_capped_kg`/`overage_kg`) compares only Moyka's own sent total against `effective_qty` — an
  audit/exception feature, narrower in scope than the availability gate just fixed. It would not
  recognize a combined Moyka+Rezka overcommit. Left as-is; flagged for whoever revisits it.
- `src/lib/stageMembership.ts`'s `hasRawRemainder(inputKg, sent)`, used by `OmborMoykaTab.tsx` to
  decide Moyka-send-window membership, reads raw `inputKg`/`sent` directly rather than the post-fix
  `available` figure — a serial fully committed to Rezka would still appear as a Moyka send
  candidate. Frontend, stage-2/Ombor-UI territory, out of scope this pass.

**`useMoykaSerials.ts` — the one frontend file touched, because it was named directly.** Confirmed
by reading the hook (not assumed): `available` is computed client-side in TypeScript from three
raw Supabase fetches (`moyka_sends`, `raw_dispatch_lines`, now `rezka_sends`), not read from a
database view — the one consumer of this balance that a SQL-only fix cannot reach. Added a fourth
fetch, a `rezkaSentBySerial` map, and `available: closedOut ? 0 : Math.max(0, input - sentTotal -
rawDispatchedTotal - rezkaSentTotal)`. `npx tsc -b --noEmit` clean.

**Decision "ship the passport fix separately and first" — investigated, found structurally
impossible, bundled instead with the reasoning made explicit rather than silently deviating.** The
`sentWeighedKg` fix (flagged in the entry above) reads a `rezka_sends_total` CTE — a table that does
not exist until this same migration's Section 2 creates it. True separation would mean either
shipping a migration that references a table that doesn't exist yet (fails), or writing the fix
twice. Bundled both `get_serial_passport` fixes — the stock-integrity `raw_storage_loss` fix (item
9 above) and the display-accuracy `sentWeighedKg` fix — into one `create or replace function
get_serial_passport`, since Postgres requires the whole function body for `create or replace`
regardless. Documented in the migration's own header comment.

**Decisions 3-5 resolved, recorded for stage 2, no code written yet:**
3. **Finalize mirrors Moyka.** Ombor clicks Tugallash when the batch is done; `final_loss_pct`
   locks; no lab involved (Rezka has no lab step at all, unlike Moyka's verdict-gated finalize).
4. **`computeFinalLossPct`'s floor gets a new, signed sibling function — not a parameter.** A shared
   function with a flag is how the Moyka path eventually starts silently accepting gains too;
   keeping Rezka's version a separate, named function keeps that door shut structurally, not by
   convention.
5. **A read-side "available to send to Rezka" RPC, mirroring `useMoykaSerials.ts`, is needed** —
   confirmed, deferred to stage 2.

**New stage-2 addition, found while resolving the above, not yet acted on:** `useAvailableFinishedStock`
and `chiqimScan` both gate on a passing CHIQIM lab verdict. Rezka pallets never acquire one (no lab
step, per decision 3), so as things stand a Rezka pallet would be receivable into stock but invisible
in Menejer's CHIQIM picker and rejected at the gate scan. This migration's database branch (the
`finished_pallets` INSERT-gate OR-branch from the entry above) does not cover it — it only lets the
pallet *in*, nothing downstream knows to let it back *out*. Frontend, stage 2.

**Verification — one clean, self-contained dry run.** Combined the full extended migration
(calibre/`rezka_sends`/`rezka_cycles`/trigger/gate/mint-RPCs from the prior entry, plus all nine
site patches above) into a single `BEGIN … ROLLBACK` `execute_sql` call — the earlier attempt to
split it across two tool calls was abandoned mid-task after confirming (via a deliberate follow-up
existence check, not an assumption) that each `execute_sql` call is its own connection and an open,
uncommitted transaction does not survive past one call. Inside the single-call transaction: real
`ombor`-role RLS impersonation via `request.jwt.claims`, then picked a real serial with a live raw
balance (`150826-001`, the same serial the 2026-08-15 tara-correction entry used), inserted a
synthetic 10 kg `rezka_sends` row, and confirmed all six read-paths that could be checked without a
`menejer` session moved by exactly -10 kg: `stock_on_hand_rows.raw_not_washed`,
`kirim_line_state.omborda_qoldi`, `get_serial_passport.joriyHolat.raw.stillInStorageKg`,
`correct_kirim_line_tara.new_available_kg`, `get_client_report.raw.closingKg`,
`rahbar_dashboard_ledger.raw.closingKg` — all exact, no rounding drift. `close_out_old_stock`'s
`old_raw` branch and both mint-caller RPCs were exercised for syntax/plan validity only this round
(numeric behavior already verified in the prior entry's dry run); not re-run against a `menejer`
session this pass. Rolled back; a follow-up read-only existence check on five representative objects
confirmed nothing persisted.

**Migration-history audit — the full diff, list only, nothing fixed here per instruction.** Compared
all 76 `supabase_migrations.schema_migrations` rows against the 75 local
`supabase/migrations/*.sql` files directly (not sampled), matching by version order and inferred
name correspondence. Three distinct patterns found, not one:

*Category 1 — a real applied migration with no local file at all (4 found):*
- `20260721124613` `yield_rows_loss_kg_fix` (between local `0030` and `0031`)
- `20260730063918` `client_report_date_basis_use_entered_date` (between local `0039` and `0040`)
- `20260803092033` `get_client_report_exclude_opening_stock_produced_v2` (between local `0060` and
  `0061`)
- `20260815031646` `kirim_lines_is_sulfured_flag` (between local `0068` and `0069` — already known;
  flagged in `0074`'s own header comment as the smaller sibling of that entry's main finding)

*Category 2 — a local file that is genuinely live in the schema, with zero corresponding
`schema_migrations` row (2 found, confirmed via direct `pg_proc` existence checks, not just
absence from the DB history — a naive DB-only diff cannot surface this pattern at all):*
- `0072_correct_kirim_line_tara_rpc.sql` (confirmed live: `correct_kirim_line_tara` exists)
- `0073_hisobot_moyka_rows_and_serial_state.sql` (confirmed live: `kirim_line_state` exists)

(`0075_rezka_data_layer.sql` correctly has no `schema_migrations` row — it hasn't been applied.
Not a discrepancy.)

*Category 3 — registered name differs from local filename, same position, same content (1 found,
cosmetic only):*
- `20260718081120`, DB name `gate_weighings_stage1_actor_timestamp_ombor_finished_by`, local file
  `0022_gate_weighings_stage_actors.sql`.

**Caveat, stated plainly rather than implied:** category-2 detection is not exhaustive by
construction — finding it required checking specific objects' live existence one at a time, which
was only done for the two files already suspected (from having applied them earlier this session).
A local file that was applied via MCP, never got a `schema_migrations` row, *and* wasn't already
suspected would not be caught by this pass. A complete sweep would need every local file's created
objects checked against live existence, one by one — not done here; reported as a limitation, not
papered over.

No fixes applied to any of the above — list only, per instruction.

**Addendum, same day — 0075 applied for real; category-2 list independently triple-confirmed;
category-1 pulled down; the sulfur-flag gap forced a renumber.** Follow-up round, same entry: apply
the extended migration, close the migration-history gaps found above, don't skip either.

*0075 applied.* Via `apply_migration` (not raw `execute_sql`), which auto-created its own
`schema_migrations` row (`20260816095709 rezka_data_layer`) — no manual backfill needed. This is
almost certainly *why* 0072/0073 went untracked in the first place: whatever applied them bypassed
this tool. Verified live afterward: `rezka_sends`/`rezka_cycles` tables, both triggers, both RPCs,
the `RKN` calibre row, and all nine site patches from Section 5 above.

*Category-2 list re-verified independently, not just re-asserted.* Ran a 4-agent workflow: three
agents each re-derived the full 76-row-DB-vs-75-local-file diff completely independently (own query,
own glob, no access to each other's or my prior answer), a fourth adjudicated by majority vote. All
three landed on the exact same 4 category-1 entries, the same 2 category-2 files, and the same 0022
naming mismatch already recorded above — unanimous. This directly answers the earlier caveat about
category-2 detection not being exhaustive: it now is, confirmed by three independent full sweeps
rather than a spot-check of files already suspected.

*Category-1 pulled down as 4 new local files — but not uniformly as 0074's own precedent.* Three of
the four (`yield_rows_loss_kg_fix`, `client_report_date_basis_use_entered_date`,
`get_client_report_exclude_opening_stock_produced_v2`) each redefine `yield_rows` or
`get_client_report` — objects that later, already-local migrations (0049 for the former; 0046
through 0075/now-0076 for the latter) have since redefined again. Literally replaying their original
`create or replace` bodies as new trailing files would run *after* those later definitions in a
fresh rebuild and regress them back to a stale mid-history shape — the opposite of the requested
no-op. These three are therefore comment-only: original SQL preserved verbatim as a comment for the
historical record, nothing executes.

The fourth, `kirim_lines_is_sulfured_flag`, turned out to be a genuine, pre-existing problem, not
just a bookkeeping gap. Its `alter table kirim_lines add column is_sulfured` is the only place that
column is created — and (`0069_wip_rows_is_sulfured_flag.sql`/`0070_classify_kirim_line_sulfur_rpc.sql`,
as numbered at the time) both already-local files reference `kirim_lines.is_sulfured` directly, one
in a view definition and one in a plpgsql function body, both of which fail at `CREATE` time (not
just runtime) if the column doesn't exist yet. **A genuine fresh rebuild of this repo's migrations
from empty was already broken before any of this session's work** — nothing created that column
ahead of the two files that need it. Not introduced here; just found here.

**Renumbering was my own judgment call, not a choice the user made.** I concluded appending at the
end (or documenting the gap unresolved) was worse than renumbering, framed the options that way, and
the user only selected from that framing — the underlying decision to renumber was mine, and an
earlier version of this entry incorrectly described it as the user's choice. Corrected here per the
user's explicit feedback. Local files `0069`-`0078` (10 files — the original
`0069`-`0075` seven, plus this round's three new record files, `git mv`'d for the seven
already-tracked ones, plain-moved for the three untracked ones) shifted up to `0070`-`0079`,
descriptive names unchanged, opening a slot at `0069` for the sulfur-flag backfill — now positioned
correctly ahead of its two dependents. That file's own backfill statement was also hardened past
its original form: the historical one-time `update ... set is_sulfured = true where
target_so2_mg_kg is not null` is unsafe to literally replay (a later human classification via
`classify_kirim_line_sulfur` could set `false` on a row that also carries a non-null
`target_so2_mg_kg`, and a blind replay would silently overwrite it) — added `and is_sulfured is
null` so the backfill only ever fills the original gap, never overwrites a later explicit decision,
regardless of when or how many times it runs.

Final numbering after the shift: `0069_kirim_lines_is_sulfured_flag_record.sql` (new) ·
`0070_wip_rows_is_sulfured_flag.sql` (was 0069) · `0071_classify_kirim_line_sulfur_rpc.sql` (was
0070) · `0072_report_totals_declared_hisobiy.sql` (was 0071) ·
`0073_correct_kirim_line_tara_rpc.sql` (was 0072) · `0074_hisobot_moyka_rows_and_serial_state.sql`
(was 0073) · `0075_wash_cycles_finalize_lab_gate_record.sql` (was 0074) ·
`0076_rezka_data_layer.sql` (was 0075) · `0077_yield_rows_loss_kg_fix_record.sql` (new, was staged
as 0076) · `0078_client_report_date_basis_use_entered_date_record.sql` (new, was staged as 0077) ·
`0079_get_client_report_exclude_opening_stock_produced_v2_record.sql` (new, was staged as 0078).
Every in-file cross-reference to the old numbers (inside the migration files themselves, plus two
live source-code comments — `src/lib/classifySulfur.ts`, `src/pages/ombor/OmborIntakeTab.tsx` — and
several `docs/SPEC.md` version-history rows) was greped for and corrected; older `DECISIONS.md`
entries above that cite the pre-renumber filenames are left as-is deliberately — they correctly
describe the state as it stood on the date each entry was written, and this file is a chronological
log, not living documentation.

*Category-2 tracking fix — SQL drafted, dry-run-validated, not yet applied.* Two plain `INSERT`s
into `supabase_migrations.schema_migrations`, not re-running either migration's DDL (0074/now-0075
drops nothing, but replaying arbitrary DDL against a database already in the target state isn't
obviously safe and isn't needed here). `statements` = the exact, unmodified content of
`0073_correct_kirim_line_tara_rpc.sql`/`0074_hisobot_moyka_rows_and_serial_state.sql` (post-rename),
byte-for-byte. Version timestamps (`20260815090000`, `20260815093000`) are reconstructed, not
authoritative — no original apply-time record exists for either, that's the entire bug — chosen to
sort after `0071`/now-`0072` (`report_totals_declared_hisobiy`, the last genuinely tracked row
before these) and before `rezka_data_layer`. Shown to the user for confirmation before applying, per
instruction; not yet confirmed as of this entry.

**Addendum, same day — attribution corrected, branch collisions checked, both tracking rows applied
and byte-verified, matching re-confirmed post-renumber.** User flagged that the entry above
originally attributed the renumbering decision to them ("user's explicit choice") when they had only
picked from a menu I'd built around my own conclusion — corrected in place above rather than left
standing.

*Collision check against 5 unmerged branches.* `ombor-tugallash-lab-gate`,
`sulfur-classification-to-laborator`, `hisobot-moyka-rows-serial-state`, and `ombor-kirim-tara-edit`
are all fully merged into `main` already (`git merge-base --is-ancestor <branch> main` true for each)
— zero unmerged commits, so nothing in them can collide with the renumbered files regardless of what
numbers their own migration files carry. `ombor-bottom-icon-nav` has genuine unmerged commits but
`git diff --name-status main...ombor-bottom-icon-nav` touches zero files under `supabase/migrations/`
(only `docs/DECISIONS.md`, `docs/SPEC.md`, and three Ombor UI components). **No collisions from any
of the five.**

*Both `schema_migrations` tracking rows applied for real, byte-verified against the local files.*
`0073_correct_kirim_line_tara_rpc.sql` (version `20260815090000`): inserted, `md5(statements[1])`
matches the local file's `md5sum` exactly (`2de471b17b0efe6876459305f2f133bb`, 6721 bytes).
`0074_hisobot_moyka_rows_and_serial_state.sql` (version `20260815093000`): the large (24664-byte,
CRLF, one embedded 4-byte emoji) body couldn't be retyped reliably by hand — repeated attempts
silently dropped a line or corrupted a byte with no SQL error to catch it. Reassembled instead via a
scratch table, base64 chunks generated entirely by shell script (never manually retyped), each chunk
verified by `md5sum` before use; final reassembled `octet_length`/`md5` (24664 /
`5e79c843bef66ab58a2a42efbc0d29d7`) matched the local file exactly before the real row was written.
An earlier, silently-wrong attempt at this same row (24170 bytes, wrong md5) had already landed in
the table from before this verification pass — caught by the `INSERT` hitting a primary-key conflict
on the version it had itself created, and corrected via `UPDATE` to the verified-correct content, not
left in place. Neither DDL body was re-run against the database — both are tracking-only rows.

*Local-to-DB matching re-confirmed for all 79 pairs post-renumber.* Matching is by the migration's
semantic name (`schema_migrations.name`, derived from content), not by local file number — so moving
ten files' numeric prefixes doesn't touch it. Rebuilt the full correspondence table fresh (79 local
files, 79 DB rows) rather than assuming the pre-renumber diff still applied verbatim: every DB row's
`name` matches exactly one local file's descriptive name, including the four comment-only "record"
files (`0069`, `0077`, `0078`, `0079`) against their corresponding already-applied DB rows. Holds
cleanly.
