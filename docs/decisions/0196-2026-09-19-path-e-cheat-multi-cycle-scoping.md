# Path E cheat version — multi-cycle wash_cycles scoping

## What this is

Schema + RPCs + core query rewrites so an admin can register a genuine
second Moyka cycle against an already-closed serial — the mechanism the
residual-reprocess investigation earlier this session (see the read-only
investigation and `docs/decisions/0195` phantom-rows cleanup preceding
this entry) concluded was the least-distorting of the three shortlisted
paths. **Admin-only, no UI**: there is no button anywhere to open a second
cycle — it happens exactly once per incident, via a direct
`open_second_wash_cycle` RPC call under the service role, matching how
rare this is expected to be (residual-reprocess is an occasional
correction, not a routine workflow).

**Partial reversal of the 2026-07-28 "Laborator v2" collapse**
(`0036_lab_relocation_reporting.sql`), which deliberately dropped
`cycle_no` and made `wash_cycles` `unique(serial)` on the premise "a serial
washes exactly once." That premise holds for ordinary operation; this
build narrowly reopens it for the one case it doesn't: a genuine second,
real Moyka event against material that already had its main run closed.

## Schema (`0124_wash_cycles_multi_cycle_scoping.sql`)

- `wash_cycles` gains `cycle_no int not null default 1` and
  `opened_at timestamptz not null default now()`.
- Backfill: every existing row is `cycle_no = 1`; `opened_at` backfilled to
  the earliest `moyka_sends.sent_date` for that serial. **5 legacy rows**
  (`020826-034/035/036/037/038` — pre-cutover seed/fixture rows,
  `status='final'`, `closed_at=null`, `finalized_at='2025-01-01
  00:00:00+00'`, an obvious placeholder sentinel) have zero `moyka_sends`
  at all; there is no `wash_cycles.created_at` column to fall back to
  (confirmed absent from live schema before this migration — the task's
  own proposed fallback didn't exist). **Approved by Abdulloh 2026-09-19**:
  reuse the same `2025-01-01` sentinel already sitting in `finalized_at`.
  Safe because `opened_at` is only ever a cycle-window lower bound for
  summing `moyka_sends`/`finished_pallets` on that cycle — with zero of
  either on these 5 rows, every window sum is 0 regardless of what date
  `opened_at` actually holds; it is never read as a period-report bucket
  key (every consumer buckets by `closed_at`, `sent_date`, or
  `received_date`, none of which exist on these rows either).
- `unique(serial)` → `unique(serial, cycle_no)`.
- New partial unique index, `wash_cycles_one_open_per_serial` — at most one
  OPEN cycle per serial at any time. This is the real backstop: every
  scalar-subquery call site across roughly a dozen functions (this
  migration's own rewrites, plus `get_serial_passport`/`yield_rows`/
  `get_client_report`/`rahbar_dashboard_ledger`/`client_serial_ledger`/
  `client_panel_summary`/`rahbar_stock_snapshot`/`lab_turnaround_avg`/
  `kirim_line_loss_range`/`kirim_line_moyka_asof`/`kirim_line_moyka_range`,
  none touched by this migration) assumes at most one row matches
  `where serial = p_serial and closed_at is null`. Verified live: a second
  concurrent open-cycle insert attempt raises `duplicate key value
  violates unique constraint "wash_cycles_one_open_per_serial"` — the DB
  itself refuses it, not just the RPC's own application-level check.

## RPCs

- **`open_second_wash_cycle(p_serial)`** — new. Validates: a closed parent
  cycle exists (`P0002` if not — "avval Yakunlash orqali yopilishi
  kerak"), no cycle is already open for this serial (`22023`), and the
  parent's own latest CHIQIM lab verdict was `o_tdi` (`22023`). Locks the
  serial's existing rows for the transaction before inserting. Writes a
  paired `audit_log` entry (`action='insert'`, `after` capturing the full
  new row), same convention as every other correction this session.
  **Gated on `auth.role() = 'service_role'`, deliberately not
  `my_role() = 'ombor'`** — this is not an Ombor-triggered flow (no UI
  button calls it), so no real app session, Ombor included, can ever
  invoke it. Verified live: `auth.role()` evaluates `null` over both a raw
  `postgres` superuser connection (MCP) and, separately, would evaluate to
  whatever a real user's JWT carries over a normal app session — neither
  is `'service_role'`; only a service-role key client (the same one
  `tests/e2e/helpers/teardown.ts` already establishes as this project's
  one precedent for elevated test/admin access) can call it.
- **`close_wash_cycle_serial`/`close_wash_cycle_if_settled`** — retargeted
  from a bare `where serial = p_serial` to
  `where serial = p_serial and closed_at is null`, so each now closes
  *the* open cycle explicitly rather than assuming there is only ever one
  row. Beyond just the row target: their own `v_sent`/`v_received`
  computation is now bounded below by that cycle's own `opened_at`
  (`sent_date`/`received_date >= opened_at::date`) — left whole-serial,
  closing cycle 2 would re-sum cycle 1's already-closed, already-booked
  history into cycle 2's residual, double-booking it. For every existing
  single-cycle serial this bound is a no-op (`opened_at` is backfilled to
  the earliest send, so nothing predates it) — confirmed live, zero drift
  on `290726-068/069/072`/`110826-001` before vs. after this migration.
- **`ensure_open_wash_cycle`** (`0125_wash_cycles_upsert_fix.sql`) — new,
  and load-bearing. See "The regression caught mid-build" below.

## SQL function rewrites

- **`client_calibre_split`** gains two optional `timestamptz` window
  params (`p_from`, `p_to`, both default `null` = unbounded, identical to
  today). Confirmed via `prosrc` search: exactly two callers exist
  (`client_serial_loss_kg`/`client_serial_moyka_kg`, both below) — safe to
  extend the signature, no third caller to break.
- **`client_serial_loss_kg`** — sums realized loss across every CLOSED
  cycle, not just "the" cycle. See "A second bug, caught by my own
  verification" below for the exact boundary rule this settled on.
- **`client_serial_moyka_kg`** — the currently-open cycle's own residual
  only (unchanged shape from before; the open cycle is always the latest
  one, so no successor-boundary concern applies here).
- **`kirim_line_state`** — `moykada` is now the sum, across cycles, of
  "0 if closed, else this cycle's own live balance" (in practice: 0 for
  every closed cycle, the single open cycle's own balance if one exists —
  the partial unique index guarantees there's at most one). `moykaga_
  yuborilgan` and `omborda_qoldi` are **deliberately left whole-serial,
  unchanged** — a serial's lifetime-sent total and its raw balance are
  correctly cumulative across cycles by definition; cycle-scoping them
  would be wrong, not just unnecessary.

## The regression caught mid-build

Dropping `wash_cycles`' plain `unique(serial)` silently invalidated every
`ON CONFLICT (serial)` upsert against the table — Postgres validates the
arbiter at parse time regardless of whether a conflict ever actually
occurs, so this was not a dormant, second-cycle-only bug: it would have
raised on the very next ordinary Ombor Moyka send, for every serial,
company-wide. Caught before any TS/UI work in this session, immediately
after applying `0124`, by auditing every `ON CONFLICT (serial)` call site
(`prosrc` search across `pg_proc`, plus a frontend grep for
`onConflict: 'serial'`) rather than assuming the migration's own scope was
the only thing touching this table. Two real call sites:

1. **`send_old_stock_to_moyka`** (SQL RPC, old-stock re-wash) — fixed
   in-place, `on conflict (serial) do nothing` → `on conflict (serial,
   cycle_no) do nothing`, `cycle_no` hardcoded to `1` (the serial it
   inserts against is always freshly minted, never a second cycle).
2. **`OmborMoykaTab.tsx`'s `handleSend`** — the everyday §5.2 send flow.
   Its `supabase.from('wash_cycles').upsert(..., {onConflict: 'serial'})`
   can't be patched to target `unique(serial, cycle_no)` or the partial
   open-cycle index through PostgREST's upsert API (no predicate support
   for a partial index arbiter). Replaced with a dedicated RPC,
   `ensure_open_wash_cycle`, added in a same-session follow-up migration
   (`0125_wash_cycles_upsert_fix.sql`).

**`ensure_open_wash_cycle`'s own behavior was deliberately narrowed**,
not simply "insert if no open cycle exists." An early draft used
`where not exists (... closed_at is null)`, which would have let an
*ordinary* Ombor send against an *already-closed* serial (via the normal
§5.2 picker, which still doesn't check `closed_at` at all — a separate,
already-flagged gap from the read-only investigation, unaffected by this
build) silently auto-open a second cycle, completely bypassing
`open_second_wash_cycle`'s own admin-only gate, parent-closed check, and
lab-verdict check. The shipped version instead inserts a `cycle_no = 1`
row **only if this serial has never had any `wash_cycles` row at all**,
`on conflict (serial, cycle_no) do nothing` — an exact behavioral replica
of the old `on conflict (serial) do nothing`: a send against an existing
serial (open OR closed) never touches `wash_cycles`. The only path to
`cycle_no >= 2` remains exclusively `open_second_wash_cycle`, admin-only,
as designed. Verified live via a rolled-back transaction: inserting a
duplicate `cycle_no=1` row for an already-closed real serial is a clean
no-op, not an error.

## A second bug, caught by my own verification

`client_serial_loss_kg`'s first draft bounded a closed cycle's own
sent/output window by `[opened_at, closed_at]` — but `closed_at` is "when
Yakunlash was clicked," not "when the next cycle's material actually
started arriving." Built a disposable `TEST-`-prefixed fixture
(`190926-001`, cycle 1: sent 500/received 480, true loss 20; cycle 2: sent
200/received 190, true loss 10) end-to-end via direct SQL (role-gated RPCs
replicated by hand, same precedent as `docs/decisions/0161`) specifically
to verify the migration before writing any frontend code, and found cycle
1 reading loss **30**, not 20 — cycle 2's 200 kg send landed on a date
within cycle 1's `[opened_at, closed_at]` window (both events fell on the
same day in the fixture's timeline) and got double-counted into the
already-closed cycle's figure.

Fixed (`0126_client_serial_loss_kg_cycle_boundary_fix.sql`) by bounding
each cycle by the **next cycle's own `opened_at`** instead (`lead(opened_
at) over (order by cycle_no)`, exclusive), never by `closed_at`. Cycles
are contiguous and non-overlapping by construction (the partial unique
index), so "everything from this cycle's `opened_at` up to the next
cycle's `opened_at`" is the correct, unambiguous partition regardless of
what calendar day the close itself happened to land on — and for the
terminal cycle (no successor), unbounded above, identical to every
single-cycle serial's original whole-serial-lifetime behavior. Re-verified
against the same fixture: cycle 1 correctly reads 20 while cycle 2 is
still open, and 30 (20+10) once both are closed. Re-verified against real
production data (`290726-068/069/070/072`, `110826-001`): byte-identical
before/after (this bug could never have manifested there — no serial in
production has ever had a second cycle — so this was caught purely by
deliberately exercising the new path before trusting it, not by any
regression it caused).

## Two more UI-state bugs, found by inspecting the consumers directly

`OmborTayyorTab.tsx`'s Window 2 (`receivedSerials.map`) and
`OmborMoykaTab.tsx`'s Window 2 (`processingRow`) both used `key={s.serial}`
and, in `OmborTayyorTab.tsx`, `expandedSerial`/`confirmingClose` state also
keyed by bare serial. Safe under the old one-row-per-serial invariant;
once a serial can produce two `OutputSerial` rows (one per cycle, see
below), a bare-serial key collides React's reconciliation across them, and
the confirm/expand state would visually apply to *both* rows at once. Not
a hypothetical — this is exactly the surface a residual-reprocess incident
lands on the moment cycle 2's first send happens. Fixed as a minimal,
mechanical key/state-identity change (`` `${s.serial}-${s.cycleNo}` ``) —
no new buttons, no new UI flow, the same screens behaving correctly under
data they previously could never have received.

## Frontend hooks

- **`useMoykaOutput.ts`** — `OutputSerial` is now one row per
  `(serial, cycleNo)`, not per serial. `sent`/`received`/`inProcess`/
  `excess`/`pallets`/`lastActivityDate`/`closedAt` are all scoped to that
  row's own cycle window (`[opened_at, next cycle's opened_at)`, or
  unbounded above for the latest cycle — same rule as the SQL side).
  `barcodeSeqByCalibre` is **deliberately whole-serial**, computed once per
  serial and copied into every cycle-row of that serial — a `barcode2` is
  a permanent PK, so the next suffix must never collide with a prior
  cycle's pallets either, not just a prior save within the same cycle.
  `isInMoyka`'s own predicate (`stageMembership.ts`) is unchanged — it
  already took `closedAt` as a required third argument (from the original
  Yakunlash build) and now simply receives a per-cycle value instead of a
  per-serial one, which is exactly what makes it keep working correctly
  with no code change there at all.
- **`useLaboratorChiqim.ts`** — already iterated one row per `wash_cycles`
  row (not per serial), so a twice-processed serial already produced two
  queue rows for free. What needed fixing was `sentKg`/`sentDate`, which
  were an unbounded whole-serial sum shared identically by both rows —
  now keyed by cycle id with the same window-boundary rule as everything
  else.
- **`effectiveQty.ts`**'s `earliestSendBySerial` — confirmed unchanged,
  correctly whole-serial-lifetime (the §2.16.2 provisional-variance flag;
  `effective_qty` is fixed once per serial, never per-cycle).

## Downstream consumers still on lifetime sums — confirmed, not touched

Per the read-only investigation's own audit, extended here with three more
found via a live `pg_proc`/`pg_views` search the original scoping missed:
`get_serial_passport`, `yield_rows`, `get_client_report`,
`rahbar_dashboard_ledger`, `client_serial_ledger`, `client_panel_summary`,
`rahbar_stock_snapshot`, `lab_turnaround_avg` — all confirmed to keep
returning identical, unchanged values for every existing single-cycle
serial (verified live, zero drift). **Three Hisobot functions
(`kirim_line_loss_range`, `kirim_line_moyka_asof`, `kirim_line_moyka_range`
— the `0186`/`0187` period-scoping functions) carry a real, not just
theoretical, bug risk once a second cycle exists**, and are explicitly
scoped into prompt (c) (client-report/Rahbar/Hisobot wiring) as first-class
items, per Abdulloh's explicit instruction — not footnotes. Until that
prompt ships, do not exercise a real multi-cycle serial through Hisobot's
period-scoped MOYKADAN/MOYKAGA views; the underlying `wash_cycles`/
`client_serial_loss_kg` data is now correct, but these three functions'
own period-attribution logic has not yet been taught about a second cycle.

## Verification

Full lifecycle validated end-to-end against a disposable `TEST-` fixture
(`190926-001`) before any frontend code was written: cycle 1 opened,
sent 500/received 480/closed (loss 20, confirmed via
`client_serial_loss_kg` and `kirim_line_state`) → `open_second_wash_cycle`
equivalent (parent-closed/no-open-cycle/lab-verdict checks all satisfied)
→ cycle 2 opened (`cycle_no=2`, DB-level partial-unique-index collision
confirmed on a simulated concurrent third open) → sent 200/received
190/closed (loss 10) → combined `client_serial_loss_kg` = 30 (20+10,
exact) → cycle 1's own `closed_at` confirmed byte-identical before and
after cycle 2's entire lifecycle. Fixture fully deleted afterward, 0
leftover rows across every table (`lab_results`, `finished_pallets`,
`moyka_sends`, `wash_cycles`, `storage_intake`, `kirim_lines`,
`kirim_orders`) confirmed by direct count.

Regression, real production data, before vs. after every migration in this
build: `client_serial_loss_kg`/`kirim_line_state` byte-identical for
`290726-068` (50/2320/92/0/2270), `290726-069` (45), `290726-072` (53),
`110826-001` (140/7320/0/0/7180) — the same four serials the phantom-rows
investigation (`0195`) had already independently verified this session.

`npx tsc -b --noEmit`, `npx oxlint`, `npm run build`, `npm test` (74/74)
all clean after the schema and hook changes.

**Playwright**: `tests/e2e/path-e-multi-cycle-residual-reprocess.spec.ts`
written, covering the full residual-reprocess lifecycle (declared 1000kg →
cycle 1 sends 800/receives 760/closes, 40kg loss → admin opens cycle 2 →
cycle 2 sends the 200kg remainder/receives 190/closes, 10kg loss → final
`client_serial_loss_kg`=50, `omborda_qoldi`=0, `moykaga_yuborilgan`=1000,
cycle 1's `closed_at` unchanged), plus the three `open_second_wash_cycle`
rejection paths (parent not closed, already-open second cycle, parent lab
verdict not a pass — the last exercised via a direct, explicitly-marked
data manipulation since `close_wash_cycle_serial`'s own gate makes that
state unreachable through normal use) and `close_wash_cycle_serial`'s own
"no open cycle" rejection. **Not run in this session — no `.env.test`
present** (same documented, repeated limitation as every other Playwright
suite built this session and across this project's history; see
`docs/decisions/0028` "Step 7 testing infra" for the standing reason:
Supabase branching requires the Pro plan, so this project has no isolated
per-task database to run destructive/RLS-authenticated e2e tests against
in a sandboxed environment). The full lifecycle it encodes was instead
verified directly against the live schema/RPCs via a disposable `TEST-`
fixture, as described above — the same level of rigor this session already
applied when a live dev server wasn't available, just via direct SQL
rather than a browser.

## Plain-language walkthrough (of the live verification, since Playwright didn't run)

Created a fake delivery, "TEST driver," 1000 kg of Subxon, confirmed into
storage. Sent 500 kg to the wash — this is cycle 1. Received one pallet
back, 480 kg — 20 kg genuinely lost in the wash. Clicked (replicated by
hand) the same "Yakunlash" close button Ombor uses — the serial's loss is
now booked at 20 kg, and checking the screen's own numbers (`kirim_line_
state`) confirms nothing is "still in the wash" for this serial any more.
Then, as the admin (not through any button in the app — this only happens
via a direct database call, on purpose, since it's rare), opened a second
wash cycle for the same serial. Tried opening a third at the same time —
the database itself refused it, on its own, before the app's own checks
even ran. Sent the remaining 200 kg through the normal send screen — it
worked, without the app trying to sneakily open a third cycle behind the
scenes. Received one more pallet back, 190 kg — 10 kg lost this time.
Closed cycle 2. Checked the serial's total loss: 30 kg (20 + 10) — exactly
right, and the FIRST cycle's own closing timestamp hadn't moved a single
second, proving the second cycle's paperwork never touched the first
cycle's already-filed numbers. Deleted every trace of the fake delivery
afterward and confirmed the database shows nothing left behind.

## Out of scope, deliberately not touched

- Cycle-2 open/close UI (still admin-only via direct RPC — this build did
  not add a button, and none was asked for).
- `get_serial_passport`'s `cycles` array (still hardcoded to length ≤1,
  `cycleNo: 1`) — prompt (b).
- `yield_rows`' grain (still one row per finished serial, not per closed
  cycle) — prompt (b).
- `get_client_report`/`rahbar_dashboard_ledger`/Hisobot's `kirim_line_
  loss_range`/`kirim_line_moyka_asof`/`kirim_line_moyka_range` wiring —
  prompt (c), with the last three carrying a real (not just theoretical)
  bug risk once a multi-cycle serial is exercised through them.
- `moyka_sends`/`finished_pallets` schema — untouched, as instructed;
  cycle membership is derived by date window, never an FK.

## Related

- The read-only investigation and `docs/decisions/0195` (this session,
  earlier) — the phantom-rows incident that motivated this build, and the
  three-path shortlist (reopen/mint-a-new-serial/new-peer-table) this
  design was chosen from.
- `docs/decisions/0161`/`0187` — the `110826-001`/`110826-002` reopen/
  reclose precedent whose "restore the true physical date, not the
  correction's execution date" lesson is exactly what motivated bounding
  cycles by `opened_at`, never `closed_at`, throughout this build.
- `docs/decisions/0147` — the original Yakunlash realized/unrealized loss
  design (migration `0101`), whose functions this build extends rather
  than replaces.
