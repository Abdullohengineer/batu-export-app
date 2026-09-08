## 2026-08-26 — Client role: totals strip, Убыток column, KN dedupe, whole-row click

User feedback on the shipped screen, six items:

1. **No totals strip, unlike the internal Hisobot.** Added, same "Движение" (row sums: Нетто,
   Накладная) / "По сериям (N)" (per-serial standing figures, summed once per distinct serial —
   the internal `TotalsStrip.tsx`'s own "the trap" rule, reused not reinvented) two-group split.
   New `client_report_totals(...)` RPC, **not** derived from the currently-fetched page —
   `client_report_rows` is `limit`/`offset`-paginated (default 200), so a client-side sum over
   just the fetched rows would silently under-count once a filter matched more rows than that.
   Shares row-building with `client_report_rows` via a new extracted `client_filtered_report_rows`
   (the old 5-branch UNION ALL, pulled out so both callers use one implementation, not two that
   could drift).
2. **Serial 260826-001 showing 7950 kg under "Остаток (сырьё)" instead of "Готовый продукт"
   — investigated, confirmed correct, not a bug.** `kirim_line_state('260826-001')`: received
   7950 kg, 0 sent to Moyka. `client_calibre_split`: 0/0. The serial genuinely hasn't been
   processed yet — all of its material is real raw stock, none of it is finished output. Told
   the user directly rather than "fixing" a number that was already right.
3. **"Убыток" (loss) column added to the main table**, per-row, same value repeated per serial
   (a state column, matching every other per-serial figure already on this table) — not just in
   the drill-down. Backed by a new `client_serial_loss_kg(serial)` function, extracted out of
   `client_serial_summary`'s own inline expression so both places (this new column,
   the drill-down's `lossKg`) share one implementation. Same basis as before: null (not zero)
   until `wash_cycles.status = 'final'`; totals strip's own Убыток chip shows "(по N из M)"
   whenever some of the filtered set's serials don't have a known loss yet, so a genuine 0 total
   is never confused with "not computed."
4. **KN listed twice in the drill-down.** `client_serial_summary`'s `by_calibre` CTE grouped
   *every* `calibre_id`, KN included, while the modal also rendered a separate hardcoded
   "Кондитерский (КН)" row from `knKg` — real double-counting in the display (not the totals,
   which were already correct). Fixed by excluding `is_numberless` calibres from `by_calibre`,
   mirroring `client_calibre_split`'s own calibre/KN split exactly — the dedicated `knKg` field
   stays the one place KN is shown.
5. **Whole row now clickable**, not just the trailing arrow — `<tr onClick>` (plus `onKeyDown`/
   `tabIndex`/`role="button"` for keyboard access, since a bare `onClick` on a `<tr>` isn't
   keyboard-reachable by default) opens the drill-down for any row with a serial; the arrow is
   now a decorative affordance only, not a second click target.
6. **Default Направление is now Приход (kirim) only**, not "every kind" — the screen used to
   open on a mixed dump of all 5 row kinds; `defaultClientReportFilters` now seeds
   `directions: ['kirim']`.

**Migration:** `supabase/migrations/0085_client_totals_loss_column_kn_dedupe.sql` — adds
`client_serial_loss_kg`/`client_filtered_report_rows`/`client_report_totals`, redefines
`client_serial_summary` (KN dedupe + shared loss call), drops+recreates `client_report_rows`
(new `state_loss_kg` OUT column — a plain `CREATE OR REPLACE` fails on a changed return shape,
same as the earlier `report_totals` precedent this repo's already hit twice). Applied to the
live project as two calls (the first attempt aborted whole — Postgres rolled back the entire
migration — when it hit the missing `DROP FUNCTION` for `client_report_rows`; re-applied in full
afterward with the drop included, confirmed via `list_migrations`/`get_edge_function`-style
re-check that every function ended up in its final, correct form, not partially applied).

**Verification.** Real Global Export data (own owner only, via the real client login's simulated
session): `client_serial_summary('290726-070')` — `byCalibre` now exactly 2 entries (Kalibr 4:
410 kg, Kalibr 2: 130 kg), `knKg: 110`, no duplicate KN row, `lossKg: 0`. `client_report_totals`
over the full history — 20 distinct serials, non-crashing, internally plausible figures (Остаток
(сырьё) 74,104 kg, Отгрузка (сырьё) 24,729 kg, Убыток 482 kg across 8 of 20 serials with a
finished wash). `client_report_rows` for that same serial, `moyka_output` direction only — all 3
rows correctly carry `state_loss_kg: 0`, matching the drill-down exactly. `npx tsc -b --noEmit`,
`npm test` (82/82), `npm run build` all clean.
