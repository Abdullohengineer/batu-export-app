## 2026-08-30 — CHIQIM truck type: Fura

**Task:** Menejer's CHIQIM request form gains a truck-type toggle — Regular (default,
current behaviour: Qorovul weighs at the gate) or Fura (too big to weigh at the gate; the
gate stage is skipped entirely and the accounting weight is the sum of Ombor's loaded kg
per line). CHIQIM only; KIRIM explicitly out of scope.

### Three investigation findings that changed the design

These are recorded first because two of them contradict what the task assumed, and the
third dictated where the completion hook had to live.

**1. There is no `chiqim_lines.loaded_kg`.** The task specified Fura's accounting weight as
`sum(chiqim_lines.loaded_kg)`. That column does not exist and never has (confirmed by
direct schema inspection, per CLAUDE.md). Ombor's loaded kg is not stored on the line at
all — it is the ledger rows the finish click writes, and it lands in **three different
tables depending on `line_kind`** (confirmed against `OmborChiqimTab.tsx`'s own
`handleFinish` and each table's live columns):

| line_kind | where Ombor's loaded kg actually lands |
|---|---|
| `finished`, `old_washed` | `chiqim_pallet_consumption.qty_kg` (FIFO-attributed by `attribute_chiqim_line_fifo`) |
| `raw`, `old_raw` | `raw_dispatch_lines.net_kg` |
| `old_kn` | `old_kn_collections.collected_kg` |

`chiqim_request_loaded_kg(request_id)` is now the single place that sum is written, so no
surface re-derives it. Nothing is stored — same discipline as `effective_qty`.

**2. No CHIQIM read path has ever used `gate_weighings.net_kg` as a value.** The task asked
what "accounting weight" means for CHIQIM reports today and where Fura's equivalent should
live. The answer is that the question does not arise: every CHIQIM quantity in Hisobot, the
client report, the passport, the Rahbar ledger and every stock balance already comes from
the three ledgers above. Verified by reading all 14 live view/function definitions that
reference `gate_weighings` — not by grep, and not by assumption. CHIQIM's gate net is
exactly what SPEC §5.4 always said it was: an informational reconciliation check, never a
value source. **A Fura therefore needs no weight substitute anywhere. Its quantities are
already correct, unchanged, with no new balance arithmetic.**

What the gate *does* supply — and what a Fura therefore breaks — is the **departure
event**. `gate_weighings.completed_at` is read in ten separate places as both "has this
load left?" and "on what date?". With no gate row, a Fura dispatch would, silently and
permanently:

- leave its pallets `band_qilingan` (reserved, never departed) in `stock_on_hand_rows` and
  `report_chiqim_rows`;
- count 0 against `kirim_line_state.olib_ketilgan`, breaking the §3.2.4 reconciliation
  identity for every serial it drew from;
- never appear in `get_client_report`'s dispatches or `rahbar_dashboard_ledger`'s departed
  figures — a client would be billed for goods the report says never left;
- never satisfy `close_out_old_stock` / `old_stock_closeout_lines`' "already departed" test;
- sit in Diqqat talab as *Jo'natish kechikdi* forever (`wip_rows.chiqim_open`).

That, not the weight, is the substance of this change. `chiqim_departed_at(request_id)` is
the one canonical answer — gate stage 2's `completed_at` for a regular truck,
`ombor_finished_at` for a Fura — and all ten call sites now go through it. **No read path
anywhere still asks `gate_weighings` directly whether a CHIQIM load departed.** The one
deliberate exception is the passport's `dispatch_gate` CTE, which renders the physical gate
record itself (weights, photos, who weighed): it must keep showing exactly that, null
throughout for a Fura, which is the truthful answer and which the new `truckType` field
lets the UI label rather than leaving as four bare "kutilmoqda" placeholders.

**3. The app does not call `finalize_chiqim_dispatch`.** That RPC exists and would have been
the natural home for the Fura completion, but `OmborChiqimTab.tsx` calls
`attribute_chiqim_line_fifo` per line and then UPDATEs `chiqim_requests.ombor_finished_at`
directly (via the open `ombor_updates` policy). Flagged, not fixed — the dead RPC is left
exactly as it is, out of scope. The consequence for this build is that the completion hook
**had to** sit on `chiqim_requests` itself, or it would never have fired.

### Decisions surfaced (each was flagged as a pick in the task)

**Completing event for Fura = Ombor's finish click**, not a new "Yuborildi" button. No new
operator action exists or is needed. Implemented as a `before update` trigger on
`chiqim_requests` setting `status := 'olib_ketildi'` in the same statement. This
deliberately differs in shape from `complete_chiqim_stage2` (after update + a second
UPDATE) for one concrete reason: that trigger writes to a *different* table than the one it
fires on, while this one writes the same row, and a `before` trigger assigning NEW avoids
both the second write and the re-entrancy that comes with it. Guarded on the
`ombor_finished_at` *transition*, not merely its value, so re-saving an already-finished
request can never re-flip a status that has since moved on.

**This does not weaken the "CHIQIM per-role finalization" invariant** (SPEC §5 intro). That
invariant forbids `chiqim_requests.status` standing in for "Ombor is done loading" — two
different facts owned by different roles. For a truck the gate never touches, Ombor's
finish click *is* the departure: the two facts genuinely coincide rather than one being
overloaded for the other. Regular trucks keep all three independent finish events,
structurally unchanged — the trigger has no effect on them at all.

**Accounting weight summed on read, never stored.** No new column. See finding 1.

**Qorovul's gate queue: excluded from Window 1 entirely**, not shown as a courtesy row with
no action. A card the guard can see but can never clear would sit in his work queue
forever, which is worse than not listing it. It appears read-only in **Window 2**
(Yakunlangan) the moment Ombor finishes, badged `Fura` and showing Ombor's loaded total
labelled `o'lchovsiz` in place of a gate net. That placement was free: Window 2's
membership is already `status !== 'kutilmoqda'`, which the completion trigger satisfies at
exactly that point.

**Undo window — documented explicitly, because it is a consequence rather than a
mechanism.** Ombor's undo of a consumption row is gated by the existing `ombor_deletes` RLS
policy on `chiqim_pallet_consumption`, whose predicate is
`chiqim_requests.status IN ('kutilmoqda','qabul_qilindi')`. For a regular truck that window
closes when gate stage 2 flips the status — unchanged. For a Fura, **the same policy,
untouched, closes it at Ombor's finish click**, because that is when the status flips. So
"undo closes at Ombor's finish click for Fura" needed no new policy and no new code; it
falls out of reusing the same status. This change adds nothing to the undo path and removes
nothing from it.

🚩 **Flagged, not silently reconciled: the task's own test list contradicts its own
requirement here.** It asks to "verify consumption rows reversed" after finishing a Fura
and immediately voiding it. That cannot hold alongside "for Fura, undo closes at Ombor's
finish click" — and the void path closes at the same instant for both truck types anyway
(`menejer_updates` already requires `ombor_finished_at IS NULL`, so no finished request can
be voided, Fura or not). The requirement was implemented as written and the e2e test
asserts the real behaviour: after a Fura finish, the undo is refused. Widening it would be a
one-line policy change, deliberately not made.

**`truck_type` is immutable once written** — its own trigger, defense in depth alongside the
fact that there is no UI path to change it (`ChiqimForm` has no edit mode; Menejer's
`Tahrirlash` in `FinishedChiqimList` touches only date/plate/driver). Same shape as the
`partiya_no` immutability precedent.

### Deliberate deviation: the Hisobot badge is not threaded through `report_rows_v2`

Every other per-row fact in Hisobot is threaded through `report_rows_v2` and its three
query functions — the pattern v1.39/v1.40 established for `partiya_no` and the kalibr
columns. That path was **not** taken for `truck_type`, and this is a deviation worth naming
rather than burying. `report_rows_v2` is a 7-branch UNION of 29 explicitly listed columns,
and `create or replace view` can only *append* a column (v1.39's own hard-won finding, from
a live `42P16`), so threading one more would mean rewriting that view plus `DROP`/`CREATE`
on `report_filtered_rows`, `report_query_page` and `report_totals` — roughly 2,500 lines of
migration to put a display badge on a default-hidden column. Truck type is not a quantity,
is not filterable and is not summed, so it is resolved client-side by
`useChiqimTruckTypes.ts`, keyed by the `requestId` the row already carries and threaded like
`ownerName`/`typeName`/`calibreLabel`. **If `truck_type` ever needs to be filterable in
Hisobot, that is the point to pay for the full threading.** The resolver is passed to both
`ReportTableRow` and `ReportRowCard` (the narrow-viewport rendering), since that file's own
header warns about exactly the drift of updating one and not the other.

The badge is restricted to the three CHIQIM row kinds whose `plate` *is* the dispatch truck
(`chiqim`, `chiqim_raw`, `chiqim_old_kn`). `moyka_output` also carries a `requestId`, but it
is that pallet's latest dispatch rather than that row's own event — which is why the row
renders `plate: null` — so badging it would attach a truck fact to a production row.

### Small addition beyond the deliverables list, flagged rather than made silently

Ombor's own CHIQIM screen shows the `Fura` badge and states, both on the request card and
again at the confirm step, that finishing closes the request and cannot be undone. This was
not in the deliverables list. It is included because the undo-window decision above makes
Ombor's click irreversible **for Fura only**, with nothing on screen that would have said
so — a hazard introduced by this change, not a pre-existing one. Menejer's Yakunlangan list
gained the same badge for the same reason: `status` reads `Olib ketildi` for both truck
types, but only a regular truck's came from a gate weighing there is a record to open.

### Rahbar dashboard

Named in the task as a display surface. Its ledger figures now include Fura departures
automatically (via `chiqim_departed_at` inside `rahbar_dashboard_ledger`), which is the part
that matters. There is no per-truck row anywhere on that dashboard — it is aggregate only —
so there is nothing for a per-trip badge to attach to, and none was invented. Flagged here
rather than reported as done.

### Verification

Supabase branching is unavailable on this plan (see the Step 7 testing-infra note), so the
migration was validated in a **disposable local Postgres 16 sandbox** before being applied
anywhere: `initdb` a fresh cluster, a small Supabase-shaped bootstrap (`auth.uid()`, the
`authenticated`/`anon` roles, `storage` stubs), then a clean replay of every migration
`0001` → `0104` in order. Only two failed, both pre-existing **data** migrations that need
real rows (`0048` opening-stock seed, `0100` serial reconciliation) — no schema failure. On
that real schema the Fura path was then exercised end to end and asserted: default
`truck_type` is `regular`; the Ombor finish UPDATE (the exact statement
`OmborChiqimTab.tsx` issues) flips only the Fura to `olib_ketildi` while a regular request
in the same transaction stays `kutilmoqda`; `kirim_line_state.olib_ketilgan` counts the
Fura's 400 kg and not the regular's 200 kg; `stock_on_hand_rows` moves the Fura's share out
of stock while the regular's stays `band_qilingan`; `wip_rows.chiqim_open` drops the Fura
and keeps the regular; the passport payload carries `truckType`/`loadedKg`/`departedAt` with
a null gate block; and `truck_type` immutability raises.

Every one of the ten read-path objects was rebuilt from the **verbatim** text of the
migration that last defined it (`0091`/`0094`/`0101`/`0102`) and patched **mechanically** at
the departure lookup only, by a script that asserts each replacement's expected occurrence
count and then re-checks that no `from`/`join gate_weighings` reference survives outside the
passport's own display CTE. Nothing in those 2,000 lines was retyped by hand, so nothing in
them can have drifted.

**Applied to the live project** (asked first, per CLAUDE.md), then verified end to end
there with `TEST-`-prefixed fixtures inside a transaction that was **rolled back** — so
nothing was left behind at all, which is stricter than the void-on-cleanup rule this
project's testing section requires. Confirmed afterwards: zero `TEST-` rows remain in
`chiqim_requests`/`kirim_orders`/`finished_pallets`/`owners`, all 7 pre-existing CHIQIM
requests carry `truck_type = 'regular'` by default, and `yield_rows` still totals 34,292 kg
consumed / 32,860 kg output / 1,432 kg loss — byte-identical to before the migration, which
is the check that the ten read-path rewrites changed no real number.

On live, after the exact `ombor_finished_at` UPDATE that `OmborChiqimTab.tsx` issues, with
one fura and one regular request in the same transaction:

| | fura | regular |
|---|---|---|
| `status` | `olib_ketildi` | `kutilmoqda` |
| `chiqim_departed_at` set | yes | no |
| `chiqim_request_loaded_kg` | 400 kg | 200 kg |
| in Qorovul's Faol window | no | yes |
| Ombor undo still open | **no** | yes |

`kirim_line_state.olib_ketilgan` = 400 kg (the fura only). The passport's dispatch payload
carries `truckType: fura`, `loadedKg: 400`, a real `departedAt` and a null `gate.netKg`,
while the regular truck's `departedAt` is still null because its gate has not weighed it.
The client report's dispatch list contains the fura and not the regular — the single
clearest proof of what this change fixes: before it, a fura's goods could be dispatched and
never appear on the client's own statement.

### One pre-existing drift found while verifying, flagged not fixed

Comparing every touched object on live against the sandbox (where the committed migration
files were replayed) showed 13 of 15 hashing identically and two differing:
`get_client_report` and `get_serial_passport`. Both differences are **SQL comments only** —
the repo's `0101` text carries a 4-line comment inside `client_pallet_departures` that the
live function does not, and `0102`'s passport comment reads "see this section's header"
in the file versus "see this migration's header" live. Re-hashing both with comment lines
stripped matches exactly (446 and 396 code lines, identical md5). So the repo migration text
and the live database had **already** drifted slightly, in comments, before this task; the
code has always been the same. Not caused by this change and not silently corrected here.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/total-loss-finalized-serials-5jeugz`.
