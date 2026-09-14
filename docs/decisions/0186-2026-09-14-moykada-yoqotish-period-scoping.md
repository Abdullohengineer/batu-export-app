# Period-scope Moykada and Yo'qotish for the in-moyka/loss invariant

## What changed

Reported symptom: serial 110826-002 showed `Yo'qotish +55` in both the
August and September Hisobot views. It should only appear in September,
where the wash cycle actually closed (2026-09-04) — August should show
`15 kg` in Moykada and no loss at all.

Root cause: `Moykada` was sourced from `kirim_line_state` (as-of-now, no
date argument) while `Yo'qotish` was sourced from `client_serial_loss_kg`
(lifetime, also no date argument). Both were deliberately deferred through
`97f5444`, `0184`, and `0185` — none of those three touched either column.
A closed serial correctly showed `0` in Moykada in every period (nothing is
still in the wash) but its **full lifetime loss figure in every period it
had any row in**, not just the one it closed in.

The operator's own invariant: on any row, in any period, either there is
in-moyka material (cycle open, loss unknowable) or there is a loss figure
(cycle closed, nothing left in moyka) — never both.

Two new SQL functions, both used only by `report_query_page`/
`report_totals` (return-table shape unchanged, `CREATE OR REPLACE`, no
`DROP FUNCTION` needed this time):

- **`kirim_line_moyka_asof(p_serial, p_to)`** — the in-moyka balance as of
  the report's own period end: `sends ≤ p_to − non-void/non-mint output ≤
  p_to`, floored at 0. Critically, **0 if the cycle closed on or before
  p_to**, mirroring `kirim_line_state`'s own closed-cycle override exactly.
- **`kirim_line_loss_range(p_serial, p_from, p_to)`** — `client_serial_loss_kg`'s
  value, but only when `wash_cycles.closed_at` falls within
  `[p_from, p_to]`; `null` ("blank," not zero) otherwise. Reuses
  `get_client_report`'s own `loss_totals` attribution shape (gate on
  `closed_at`, then read the realized figure), per instruction, rather than
  inventing a new one.

`reportColumns.ts` — Yo'qotish's `totalBasis` restored from `'none'` to
`'state'` (its strip chip comes back); Moykada stays `'state'` (unchanged
key, redefined meaning). `TotalsStrip.tsx` and `ClientPrihodTab.tsx` both
restore the Yo'qotish chip. No TypeScript shape changes anywhere — every
field these two columns use already existed (`state.moykada`,
`state.yoqotish`, `stateMoykada`, `stateYoqotish`), only their SQL source
changed.

## The closed-cycle override is not optional

An early draft of `kirim_line_moyka_asof` omitted the closed-cycle check —
just `greatest(0, sends≤p_to − output≤p_to)`. This looked right for
110826-002 (the `greatest(0, ...)` floor happened to zero out a negative
result). It was live-caught wrong on **190826-001**, which closed today
(2026-09-14) mid-investigation: September showed `Moykada = 425` **and**
`Yo'qotish = 425` simultaneously — a direct invariant violation. The reason:
for a closed cycle, the raw `sends − output` difference **is** the
loss/surplus, not a leftover balance; showing it as "still in Moyka" is the
exact same category error the whole fix exists to correct, just relocated
into the new function instead of removed. Adding the override (0 whenever
`closed_at ≤ p_to`, matching `kirim_line_state`'s own logic) fixed it.

## Additivity

**Yo'qotish**: confirmed live. August closings alone sum to 1,452 kg;
September closings alone sum to 3,766 kg; the two together equal 5,218 kg —
exactly the sum for the combined August–September range, and exactly the
old lifetime total (every closed serial's loss is recognized in precisely
one period and blank everywhere else — a genuine partition sum). Strip chip
restored.

**Moykada**: kept as a strip chip, but on different grounds than
additivity — it's a snapshot, not a flow, so "does it sum correctly across
stacked periods" isn't the right test (nobody should add two different
reports' balance figures together regardless of basis; that was already
true when this column was as-of-now). As-of-p_to is arguably a **better**
snapshot for a filtered report than as-of-now was — it answers "what was
sitting in Moyka as of the period you're actually looking at" rather than
"what's in Moyka right now regardless of your filter."

## Impact on other identities

**Qabul qilingan** (`= Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan`):
unaffected. It contains no Moykada term, and none of its own three terms
changed — all three still read `kirim_line_state` directly, untouched by
this entry.

**Moyka-internal identity gap** (`Moykaga yuborilgan (jami) = Moykadan
chiqgan (jami) + Moykada + Yo'qotish`): reproduced the exact scope
`97f5444` originally used (`report_filtered_rows(null,'2026-01-01',
'2026-12-31',...)`'s distinct-serial set) for both the old and new
formulas. Old: `diff = -17,830`. New, same scope: `diff = -17,830`.
Identical to the kilogram — **this entry leaves that gap untouched**,
neither closing nor changing it. Expected: neither `jami` term changed,
and Moykada/Yo'qotish's redefined values sum to the same totals at
full-range scope as their predecessors did.

## Приход impact

Both columns are read through the same shared RPCs — the change is
automatic on the client portal's table cells. `ClientPrihodTab.tsx`'s
`ClientTotalsStrip` restores its Yo'qotish chip too, mirroring Hisobot
(same additivity argument, no independent re-derivation needed). Moykada's
chip there is unaffected — already present, meaning just redefined the
same way.

## Precedent this fix aligns with

`src/lib/formatLoss.ts`'s own `computeLossDisplay` already documents the
canonical rule: *"An OPEN serial's gap is still-in-process (Moykada, not a
loss yet); a CLOSED serial's gap is booked loss (Yo'qotish)... Every
SQL-sourced payload (passport, Hisobot, Yield, client report, Rahbar) gets
pre-split fields computed by the identical rule server-side (wash_cycles.
closed_at gated, same two branches)."* Hisobot's report engine was the one
place that had the closed/open split for *whether* a loss is booked, but
not yet the *which period it's attributed to* half of the same rule — this
entry closes that gap, bringing it in line with the rest of the app rather
than introducing a new convention.

## Blast radius

Grepped all 28 files referencing "moykada" in `src/`. The only other
consumers of an in-moyka concept are `SerialPassportModal.tsx` (via
`serialPassport.ts`, a wholly separate RPC that already implements this
exact split independently) and `rahbarDashboardV2.ts`'s ledger (its own
`moykadaKg`, explicitly documented as "Point-in-time... not the
period-scoped moykadaSnapshot" — a different, unrelated system).
`kirim_line_state` itself is untouched; only `report_query_page`/
`report_totals`' own source for these two fields changed. Blast radius is
contained to Hisobot + Приход, as intended.

## Verification

- `npx tsc --noEmit` — clean.
- Live (not dry-run) after applying: `report_query_page`, 110826-002,
  MOYKADAN direction — August `state_moykada=15, state_yoqotish=null`;
  September `state_moykada=0, state_yoqotish=-55` (renders `+55 kg`, a
  surplus, per `formatLoss.ts`'s sign convention). Matches the operator's
  expected table exactly.
- All 5 known cross-month serials, both months — see the before/after
  table below. Full-dataset invariant check (every serial with a wash
  cycle, every month January 2025–September 2026): **0 violations**.
- 🚩 **UI-level verification not performed this session.** A Playwright
  regression test was written
  (`tests/e2e/moykada-yoqotish-invariant.spec.ts`, mirrors
  `hisobot-moykadan.spec.ts`'s live-data convention) asserting both the
  110826-002 before/after and the structural "never both nonzero on one
  row" invariant across the whole August–September MOYKADAN view — but
  this session's container has no `.env.test` (gitignored, not present in
  a fresh checkout), so `loginAs()` cannot authenticate and the test could
  not actually be run. The SQL/RPC-level verification above is exhaustive
  (direct function calls, live `report_query_page` results, full-dataset
  invariant sweep), but the UI rendering itself (column picker enabling
  Moykada, `StateCell`/`formatLossKg` producing the exact expected table
  text) has not been confirmed end-to-end. Flagging this explicitly per
  CLAUDE.md rather than claiming UI verification that didn't happen — the
  test should be run for real the next time this environment (or one with
  `.env.test`) is available.

## Before/after — all 5 known cross-month serials, both months

| Serial | Month | Moykada (before → after) | Yo'qotish (before → after) |
|---|---|---|---|
| 110826-002 | Aug | 0 → **15** | +55 → **blank** |
| | Sep | 0 → 0 | +55 → **+55** |
| 110826-003 | Aug | 0 → **7,190** | 540 → **blank** |
| | Sep | 0 → 0 | 540 → **540** |
| 180826-001 | Aug | 0 → **7,960** | 600 → **blank** |
| | Sep | 0 → 0 | 600 → **600** |
| 190826-001 | Aug | 0 → **8,165** | 425 → **blank** |
| | Sep | 0 → 0* | 425 → **425** |
| 190826-002 | Aug | 700 → 700 | 952 → **blank** |
| | Sep | 952 → 0* | 952 → **952** |

\* 190826-001/190826-002 closed 2026-09-14, mid-investigation — their
September "before" figures were live and already showing the invariant
violation this fix corrects, not a hypothetical.

## Related

- `docs/decisions/0185-...-hisobot-row-column-model-correction-ii.md` —
  the immediately preceding entry, which explicitly deferred both Moykada
  and Yo'qotish's period-scoping as separate, later tasks. This entry is
  that follow-up, not a further correction of 0185's own reasoning.
- `kirim_line_moyka_range`/`kirim_line_calibre_output_range` (from
  `0185`) and the two new functions here (`kirim_line_moyka_asof`/
  `kirim_line_loss_range`) are now the full set of period-relative helper
  functions backing Hisobot's Moyka/kalibr/loss columns.
