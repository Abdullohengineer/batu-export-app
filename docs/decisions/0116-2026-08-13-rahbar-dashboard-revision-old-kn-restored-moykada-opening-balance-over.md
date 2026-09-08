## 2026-08-13 — Rahbar dashboard revision: old-KN restored, Moykada opening balance, over-send edge case

**Context:** First revision round against the 2026-08-12 draft — four defects, two agreed
changes.

**Decision:**
- Root-caused the reported "52,210 should be 51,170" defect as a false premise, not a bug:
  migration 0059 (2026-08-03) fully reverted the Stage 3 re-wash test and reissued the same
  1,040 kg (barcodes `PLT-020826-037-06-1/-2` → `PLT-020826-038-06-1/-2`, serial
  `020826-038`) before this dashboard existed. `serial_mint_sources` was empty at the time;
  its exclusion clause was a correct no-op, not a broken one. 52,210 stood, confirmed against
  `stock_on_hand_rows` independently.
- `chart_kirdi` gained the `has_intake` filter `raw_received_total` already had; `chart_chiqgan`
  and `chart_vozvrat` gained the `between p_from and p_to` upper-bound guard `chart_kirdi`
  already had — weekly buckets whose span isn't a multiple of 7 days left the final bucket's
  naive upper edge past `p_to`, leaking later events in. Both gaps confirmed live before the
  fix and closed after.
- Old-KN pool stock restored as its own `oldKnKg` snapshot key, included in `totalKg` and
  `byType`, explicitly separate from and never reconciled against Ledger C. Omitting it
  entirely (the 08-12 draft's choice) hid ~103,936 kg of real client-owned stock; judged the
  worse error.
- Ledger B gained its own identity: `moyka_opening_total`, the same `moykada_total` formula as
  the existing closing snapshot, evaluated at `p_from` instead of `p_to`. Verified live on a
  straddle fixture: opening 500 + sent 700 − processed 800 = 400 = closing, exact.
- **Edge case found and left unfixed, by design:** when a line is sent to Moyka for more than
  its own effective raw quantity (`report_kirim_rows_as_of`'s `qty_kg`), (1) the new Ledger B
  opening/closing identity shows a residual equal to the over-send amount, because
  `sent_capped_kg` caps at the declared quantity while the Moykada snapshot formulas use the
  uncapped sent total; and (2) for the same reason, Ledger A's own `opening + kirdi − vozvrat −
  moykaga = closing` identity can also undershoot by the same residual, because
  `raw_closing_total` floors at `greatest(0, ...)`. Both verified live with disposable fixtures
  (600 kg declared, 900 kg sent → 300 kg residual in both cases). Not fixed: capping
  `raw_received_total`/`moyka_sent_period_total` to match the floor would be a new, unconfirmed
  gating scheme, and `get_client_report` carries the identical `greatest(0,...)` characteristic
  and is out of scope for this task.

**Follow-ups (not fixed, flagged only):** the `get_client_report` `raw_received_total` gap
(2026-08-12 entry) and the over-send floor characteristic above both remain open on
`get_client_report`.
