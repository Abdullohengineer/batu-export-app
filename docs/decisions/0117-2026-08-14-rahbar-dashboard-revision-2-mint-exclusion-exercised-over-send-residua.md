## 2026-08-14 — Rahbar dashboard revision 2: mint exclusion exercised, over-send residual surfaced, date-basis conflict flagged (deferred)

**Context:** Second revision round — two fixture tests and one investigation, the
investigation reported but not implemented.

**Decision:**
- `serial_mint_sources`'s exclusion clause in `pallets` (both `rahbar_dashboard_ledger` and
  `get_client_report`) confirmed live, not dead code: `mint_serial_from_sources` (0055) writes
  real rows on its current path. Exercised with a disposable fixture replicating the mint flow
  exactly — source pallets dropped out of the ledger, out of Eski finished closing, and out of
  the snapshot; the minted serial's own output correctly landed under Yangi scope
  (`origin='internal_reprocess'`). First time the clause has ever fired against real-shaped
  data.
- Added `raw.residualKg` and `moykadaSnapshot.residualKg` to `rahbar_dashboard_ledger` —
  diagnostic-only, computed from the already-existing CTEs, no balance formula touched. Both
  read 0 on all real data. Verified on a 600-declared/900-sent fixture: raw residual −300,
  Moyka residual +300 — same magnitude, opposite sign by construction (each formula's own term
  order), not an inconsistency.
- **Investigated, not implemented, then formally deferred by Abdulloh (2026-08-14):** a
  proposed rule to date inbound/outbound movements by finalization (Ombor + gate) rather than
  by Menejer's entered date directly contradicts SPEC.md §3.2.3 (v1.24) and the 2026-07-30
  decision "Reports showed the wrong date," which deliberately reverted the system away from
  gate-timestamp dating for exactly this reason — order entry and the physical gate event
  landing on different days is "the normal case," not an edge case, and that decision
  explicitly extended to `get_client_report`'s dispatch-side bucketing with the user's own
  sign-off. `rahbar_dashboard_ledger` is already built on the current (entered-date) rule and
  is not the source of any drift. Live data quantified: 0 change to any period total on the
  live period tested (kirdi's per-line dates shift up to 13 days within the same window;
  vozvrat/olib ketilgan show zero gap on all 3 real CHIQIM requests in that period). **Both
  deferred, not implemented, per Abdulloh's call — the возврат gate-weigh-2 gate and the kirdi
  intake→gate-weigh-2 change stay open follow-ups, revisit if the conflict with §3.2.3 is
  ever deliberately resolved the other way.**

**Source-mapping (requested this round):** most `rahbar_dashboard_ledger`/
`rahbar_stock_snapshot` figures re-derive an existing per-owner `get_client_report` formula at
factory-wide grain, or read `stock_on_hand_rows`' rows directly. Genuinely new, with no
existing source: the two residual lines, `moykadaSnapshot.openingKg`, `byCalibreType`'s
type×calibre cross, and the chart's three time-bucketed series. No existing view was changed
to manufacture a shared source for any of these.

**Follow-ups (not fixed, flagged only):** the `get_client_report` `raw_received_total`
has_intake gap and the over-send floor characteristic (both above) remain open. The date-basis
conflict is now a formally deferred item, not fixed, per Abdulloh's 2026-08-14 call.
