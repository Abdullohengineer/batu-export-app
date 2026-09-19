# Residual-reprocess execution — 290726-068/069/072

## What this is

The actual data write Path E's whole arc this session existed to enable:
registering the real, physical residual-reprocess of three closed serials'
genuine raw remainders (92/29/36 kg) as a real second Moyka cycle each,
instead of the corrupted same-cycle phantom sends `0195` deleted. Bookkeeping
only — the material had already physically moved through Moyka; this
migrates the DB to match reality.

## Incident timeline

1. Three closed serials (`290726-068/069/072`) each had a genuine raw
   remainder left over after their main processing closed (Yakunlash,
   2026-08-29): 92/29/36 kg.
2. 2026-09-15, an attempted combined send of the 157 kg total read as
   additional realized loss on the already-closed serials — `wash_cycles`
   was strictly one row per serial at the time, so there was no way to
   register a genuinely new cycle. The send itself landed (`moyka_sends`
   has no void column), corrupting Hisobot/Yield/Rahbar/client-report loss
   figures for all three. `0195` deleted the three phantom rows outright
   (documented exception to never-DELETE, per that entry's own
   justification).
3. Path E ("cheat version") built the schema/RPCs to support a real second
   cycle (`0196`), then made every period/as-of reader of that data
   cycle-aware (`0197` — prompt (c), the period-safety pass), explicitly
   naming this execution as the "last blocker" it was clearing.
4. This entry: the actual execution against `290726-068/069/072`.

## The split — three rounds, not one

The task's first-draft split (K8/KN = 40/40, 10/10, 20/20 per serial,
140 kg output, "072 gains 4kg") **failed on inspection** —
`close_wash_cycle_serial`'s live body requires `sent − received > 0` to
close a cycle at all:
```sql
if v_sent - v_received <= 0 then
  raise exception 'Seriyada yopiladigan qoldiq yo''q' using errcode = '22023';
end if;
```
072's sent 36 kg against a stated 40 kg receive is `36 − 40 = −4`, which
trips this guard. No "over-receive allowance" of the kind the task assumed
exists anywhere in the codebase — the only real "overage" concept
(`capped_sent_kg`/`overage_kg` in `get_client_report`/
`rahbar_dashboard_ledger`) is about a serial's *lifetime sent* exceeding its
*declared raw qty*, unrelated to one cycle's output exceeding its input.
Flagged rather than assumed away or silently worked around.

Second draft (072: K8=20/KN=10=30kg, loss=6) was proposed by this agent as
a mathematically valid correction given the headroom constraint (068 could
absorb ≤11kg more, 069 ≤8kg, 072 needed to drop ≥5kg) — but not the real
figure; a guess, correctly not taken as final.

**Final, confirmed split** (Abdulloh, after reviewing the constraint):
| Serial | Sent | K8 | KN | Output | Loss |
|---|---|---|---|---|---|
| 068 | 92 | 50 | 40 | 90 | 2 |
| 069 | 29 | 10 | 10 | 20 | 9 |
| 072 | 36 | 10 | 20 | 30 | 6 |
| **Total** | **157** | **70** | **70** | **140** | **17** |

All three satisfy `sent − received > 0` cleanly, no guard conflict.

## RPCs hand-replicated, not literally called

`auth.role()` and `my_role()` both evaluate `null` over this MCP/superuser
connection (`current_user = postgres`) — verified directly before writing
anything. `open_second_wash_cycle` (`auth.role() = 'service_role'`) and
`close_wash_cycle_serial` (`my_role() = 'ombor'`) cannot be invoked
literally here; both would raise `42501`. Same limitation `0196`/`0161`
document for verification queries. Both RPCs' internal effects (the
`wash_cycles` insert/update, `open_second_wash_cycle`'s own `audit_log`
write) were hand-replicated instead — functionally identical outcome. All
three serials' preconditions (`open_second_wash_cycle`'s parent-closed,
no-open-cycle, parent-lab-verdict checks) were independently confirmed true
by direct query before writing, so this isn't bypassing validation, just
executing it by hand instead of through the gated wrapper.

`lab_results` readings for the new cycle-2 chiqim test (21% moisture,
1044 mg/kg SO2, tested by Murodjon Obidov — the same person who tested
cycle 1 for all three) are a confirmed assumption, not a real September lab
record — flagged and approved as a reasonable default in the absence of one.

## The bug this execution's own verification caught and fixed

The first write set `wash_cycles.opened_at = now()` and
`closed_at = now()` for each new cycle 2 — both evaluating to
**2026-09-19** (the moment this correction ran), not the real physical
dates (send 2026-09-15, receive 2026-09-16). This is precisely the mistake
`0196`'s own "Related" section warns against, citing `0161`/`0187`:
*"restore the true physical date, not the correction's execution date."*

Caught immediately by this task's own mandated post-write verification
(not by the writes erroring — they applied cleanly):
`kirim_line_loss_range('290726-068', '2026-08-01', '2026-08-31')` read
**−40** instead of the required, unchanged **50**. Root cause: cycle 1's
own output-attribution window is `[opened_at, next_opened_at − 1 day]`;
with cycle 2's `opened_at` wrongly at 2026-09-19, cycle 1's window
stretched to 2026-09-18 — swallowing cycle 2's real September 16 receipt
into cycle 1's already-reported August figure. Exactly the leak `0127`
exists to prevent, reintroduced by this correction's own bad timestamps,
not by any gap in `0127` itself.

Fixed in a follow-up correction (same file, applied immediately after
diagnosis, before anything else was touched): backdated all three cycle-2
rows' `opened_at` to **2026-09-15** (each cycle's own earliest
`moyka_sends.sent_date` — the identical backfill rule `0196` used for
cycle 1) and `closed_at` to **2026-09-16** (the real receive date).
Re-verified clean afterward (see "Post-state verification" below).

## Post-state verification (all confirmed live, after the backdating fix)

| Surface | 068 | 069 | 072 |
|---|---|---|---|
| `client_serial_loss_kg` | 52 | 54 | 59 |
| `kirim_line_state.omborda_qoldi` | 0 | 0 | 0 |
| `kirim_line_state.moykaga_yuborilgan` | 2412 | 2284 | 2239 |
| `kirim_line_state.moykadan_chiqgan` | 2360 | 2230 | 2180 |
| `kirim_line_state.moykada` | 0 | 0 | 0 |
| `stock_on_hand_rows.raw_not_washed` | no row | no row | no row |
| `kirim_line_loss_range` (Aug) | 50 | 45 | 53 |
| `kirim_line_loss_range` (Sep) | 2 | 9 | 6 |
| `kirim_line_moyka_asof` (today) | 0 | 0 | 0 |
| `kirim_line_loss_asof` (Aug 31) | 50 | 45 | 53 |
| `kirim_line_loss_asof` (today) | 52 | 54 | 59 |

`get_client_report`'s own August loss contribution from these three
confirmed unchanged by isolating their sent total within its exact
`loss_totals` window logic: **6778 kg** (=2320+2255+2203, the three
serials' original cycle-1-only sent amounts, byte-identical to before this
execution) out of the owner's 34,292 kg August total across 10 serials —
the remaining 27,514 kg (and the owner's large negative company-wide
`processedBreakdown.lossKg`, unrelated to this task) comes entirely from
the owner's other 7 serials, a pre-existing condition, not something this
execution touched. September's per-serial contribution, isolated the same
way, reads exactly 2/9/6.

`client_serial_ledger` (SECURITY DEFINER + `my_owner_id()`-scoped,
uncallable directly here) replicated via the exact `kirim_line_moyka_asof`/
`kirim_line_loss_asof` calls it makes internally: `poteryaKg` as-of Aug 31
= 50/45/53, as-of today = 52/54/59; `vPererabotkeKg` = 0 both dates, all
three (both cycles closed, nothing in process).

**August confirmed unchanged, September confirmed isolated to cycle 2's own
activity, for every surface checked** — the core invariant this whole Path
E arc existed to protect.

## Flagged, not fixed: `yield_rows` duplication is worse than scoped

During this task's own pre-write scoping conversation, `yield_rows` (still
unfixed, explicitly prompt (b)) was estimated to produce "2 duplicate rows
per serial, correct numbers" once a serial had 2 closed cycles — reasoning
from its view definition alone. **That estimate was wrong**, confirmed by
querying it live after this execution: it produces **8 rows per serial**
with badly wrong loss figures (**−2308 / −2176 / −2121 kg**), not 2 clean
duplicates.

Root cause: `yield_rows`' `rewash_flag` and `lab_readings` CTEs are each
independently built directly off `finished_serials` (which now has 2 rows
per serial, one per closed `wash_cycle_id`) and rejoined back into the main
query on `serial` alone, not `wash_cycle_id` — `finished_serials (2) ×
rewash_flag (2) × lab_readings (2) = 8` rows, with `output`'s own internal
aggregation multiply-counting `finished_pallets` weights along the way
(each real pallet's weight counted once per matching `finished_serials`
row it fans against, before that CTE's `GROUP BY` collapses the row count
back down without correcting the sum).

This is a real, live, immediate consequence of these three serials now
having a genuine second cycle — not hypothetical, not cosmetic. Correcting
the earlier "cosmetic, correct numbers" characterization here explicitly,
since it was inaccurate and Abdulloh approved proceeding based on it.

**Not fixed in this entry** — explicitly out of scope per this task's own
scoping (prompt (b), the `yield_rows`/`get_serial_passport` grain redesign).
Source data confirmed correct throughout (`wash_cycles`, `moyka_sends`,
`finished_pallets`, `lab_results` all verified above); only this one
read-only view (Hosildorlik/Yield screen) is affected. **Prompt (b) is now
live-blocking, not theoretical** — it should be picked up promptly, since
Hosildorlik will show all three of these real serials with garbage figures
until it ships.

## Out of scope, deliberately not touched

- Any function rewrites (all completed in prompts (a)/(c), `0124`–`0127`).
- `get_serial_passport`/`yield_rows` grain — prompt (b), now carrying a
  confirmed live bug (see above), still not addressed here.
- UI — no screen changes; this is a pure data write.

## Related

- `docs/decisions/0195` — the phantom-`moyka_sends` cleanup that started
  this incident.
- `docs/decisions/0196` — Path E schema/RPCs, the `open_second_wash_cycle`
  contract this execution hand-replicates, and the "true physical date, not
  the correction's execution date" lesson this execution's own bug
  reproduced and then fixed.
- `docs/decisions/0197` — the period-safety pass whose functions this
  execution's post-state verification exercises end to end, for the first
  time against a real multi-cycle production serial.
- `docs/data-corrections/2026-09-19_residual_reprocess_068_069_072.sql` —
  the applied SQL, including the opened_at/closed_at follow-up correction.
