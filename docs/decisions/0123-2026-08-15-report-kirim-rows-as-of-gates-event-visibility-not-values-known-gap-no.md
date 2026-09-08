## 2026-08-15 — `report_kirim_rows_as_of` gates event visibility, not values (known gap, not fixed)
**Context:** found while investigating a manual tara correction on serial `150826-001` (box mass
355 → 513 kg, which moves effective_qty from 8,105 → 7,947 kg) and while designing the upcoming
Ombor KIRIM tara-edit RPC. Read `report_kirim_rows_as_of(p_to)` and the live `report_kirim_rows`
view directly, side by side.

**Finding:** both functions compute the exact same `qty_kg` formula (declared → intake-provisional
→ gate-net-minus-box-mass, per line count and which of gate stage 2 / box mass are known) off the
*current, live* `storage_intake.box_mass_kg`/`actual_qty` and `gate_weighings.net_kg`. The only
thing `_as_of(p_to)` adds is gating whether an event (`storage_intake.confirmed_at`,
`gate_weighings.completed_at`) happened on or before `p_to` before counting that row at all — it
answers "was this delivery known yet as of that date," never "what did this delivery's numbers say
as of that date." There is no value-versioning anywhere in this schema (consistent with "derive,
don't store" everywhere else), and `_as_of` was never built to provide any — it solves a real,
different problem (excluding deliveries that hadn't happened yet from a backdated report), not
retroactive-correction protection.

**Consequence:** correcting `storage_intake.box_mass_kg` (or `actual_qty`, or anything else
`report_kirim_rows`/`_as_of` read) after the fact changes what *any* as-of query for a date on or
after that correction's underlying event returns, immediately and silently — including a fresh
`get_client_report` run for a `p_to` that covers a delivery whose figures already changed since an
earlier report covering the same period was generated and handed to a client. The as-of machinery
gives zero protection against this; it was never designed to.

**Not fixed now** — flagged per the user's explicit instruction, out of scope for the tara-edit
work this entry accompanies. Closing this gap for real would need one of: (a) exported reports
persisted as frozen artifacts (a snapshot file/record, not a live re-render, so "what was handed to
the client" stops being re-derivable from current table state), or (b) genuinely effective-dated
corrections (the corrected column carries its own "effective as of" value alongside the current
one, and `_as_of(p_to)` reads whichever was true at `p_to` instead of always reading the live
value). Either is a real schema/architecture change, not a small patch — noted here so it isn't
silently rediscovered as a surprise later.

**Related, same investigation:** `report_kirim_rows.qty_kg`'s own CASE expression was, at this
point, hand-duplicated in two places already (the view itself and `report_kirim_rows_as_of`) —
adding the tara-edit RPC (`correct_kirim_line_tara`, needing the same formula twice, before and
after its own write) would have made a third and fourth copy of one balance calculation, on a
feature whose entire purpose is editing one of that formula's inputs. Extracted into
`kirim_line_effective_qty(p_serial)` instead (see `0072_correct_kirim_line_tara_rpc.sql`) — but
**not** wired into `report_kirim_rows`/`report_kirim_rows_as_of` in this pass, since that would mean
touching two already-shipped, load-bearing, heavily-tested objects for a change out of this task's
stated scope. **The view and the as-of function are both candidates to adopt this helper later**,
collapsing three copies down to one — flagged here so it isn't lost, not done now.
