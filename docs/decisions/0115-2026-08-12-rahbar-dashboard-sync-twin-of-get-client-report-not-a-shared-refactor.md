## 2026-08-12 — Rahbar dashboard: sync-twin of get_client_report, not a shared refactor

**Context:** `rahbar_dashboard_ledger` (0068) needs the same opening/kirdi/chiqdi/closing raw
and finished balance logic as `get_client_report` (0065) — factory-wide instead of per-owner,
scope-filtered on `kirim_orders.origin` instead of unfiltered. Extracting a shared helper was
considered and explicitly rejected.

**Decision:**
- `rahbar_dashboard_ledger` duplicates `get_client_report`'s CTE shapes directly rather than
  factoring out a common function. The migration's header comment carries a full CTE-name
  mapping table between the two functions. Any change to a shared formula in one must be
  hand-applied to the other — there is no compiler or test that will catch drift automatically.
- One real deviation was found and kept, not silently inherited: `raw_received_total` in
  `rahbar_dashboard_ledger` adds a `has_intake` filter that `get_client_report`'s identical
  formula lacks. Found live (real serial `110826-003`, 7,160 kg) — without it, "kirdi" could
  count a serial invisible to "closing," breaking the identity. `get_client_report` was left
  untouched (out of scope for this task) but carries the same latent gap — logged as a
  follow-up below.
- The "Moykada" line was requested sourced from `wip_rows`, but `wip_rows` has no kg column
  and only covers wash cycles already past the idle-days threshold — structurally cannot
  supply "kg currently in Moyka." Substituted `get_client_report`'s own `moykada_total`
  formula instead: still zero new derivation, just a different already-verified source.
- Konditirskiy tile (`rahbar_stock_snapshot`) excludes the `old_kn` bucket entirely — Ledger C
  is `finished_pallets`-based and structurally cannot reflect old-KN pool balance, so folding
  it into the tile would silently disagree with the ledger under Eski/Hammasi scope. KN origin
  tracking stays out of scope; this dashboard doesn't claim old-KN coverage anywhere.
  (Superseded 2026-08-13 below — old KN restored as its own separate figure.)

**Alternatives considered:** Extracting shared CTEs into a parameterized helper function
(owner filter optional) — rejected per direct instruction; duplication is accepted as the
simpler, more auditable path given `get_client_report`'s existing complexity.

**Follow-up, not fixed:** `get_client_report`'s own `raw_received_total` still lacks the
`has_intake` filter described above.
