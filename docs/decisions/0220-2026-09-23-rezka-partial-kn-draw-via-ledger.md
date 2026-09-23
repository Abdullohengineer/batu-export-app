# Rezka: internal Konditerka draw is kg-based and partial, recorded in a ledger

**Context.** Internal KN goes to Rezka in boxes (≥ ~10 kg), so a draw is almost never a whole
pallet. The audit (`docs/REZKA-AUDIT.md` §5) found `mint_serial_from_sources` consumes whole
pallets only: it flips `finished_pallets.status` to `consumed`, and `serial_mint_sources`'
CHECK forbids a `weight_kg` on `source_kind='pallet'` rows. Product owner rejected whole-pallet
drawing and asked for a ledger shaped like `chiqim_pallet_consumption`, with
`finished_pallets` and `serial_mint_sources`' constraint left untouched.

**Built (`0142`).**
- `rezka_kn_draws(draw_id, minted_serial → kirim_lines, barcode2 → finished_pallets, qty_kg > 0,
  drawn_at, drawn_by)`. Keyed on `barcode2` because `finished_pallets` has **no id column** —
  `barcode2` is its PK (same as `chiqim_pallet_consumption`). Append-only: RLS `read_all` +
  `client_read_own_*`, no write policy (written only by the security-definer RPC).
- `send_kn_to_rezka(p_owner_id, p_type_id, p_kg) returns text` — a **new** RPC, not a rewrite of
  `send_finished_pallets_to_rezka` (the signature changes). One transaction: ombor check;
  `p_kg > 0` (no hard minimum — soft-warning philosophy, Prompt 2 warns under 10 kg); mint the
  serial (`origin='internal_reprocess'`, `process='rezka'`, plate `QAYTA-ISHLASH`, no
  `storage_intake` → no Barcode #1, no gate/intake/lab queue); lock candidate pallets
  `for update`; allocate FIFO by `received_date, created_at, barcode2`, partial on the last
  pallet; insert ledger rows; `rezka_cycles` (cycle 1) + one `rezka_sends` row for the same kg
  + a note. Candidates: Konditerka calibre (`is_numberless and not is_rezka_output`),
  `in_stock`, not voided, not old stock, same owner + type, parent `process='moyka'`, lab
  passed (latest chiqim verdict `o_tdi` on the serial's **latest** wash cycle — deliberately
  not the dispatch gates' `limit 1, no order`, see `0223`), remaining kg > 0. Insufficient
  stock raises and rolls the mint back.
- Overdraw guard both ways: `check_chiqim_pallet_consumption_not_overdrawn` now counts draws,
  and a twin trigger on `rezka_kn_draws` runs the same check.

**Every available-KN read site** — all 20 live objects that read `chiqim_pallet_consumption`
were classified. Patched (draws become a sibling of the existing consumption term; no new
balance calculation): `stock_on_hand_rows` (→ qoldig'i, `rahbar_stock_snapshot`,
`get_serial_passport` finished-still), `finished_pallet_availability` (→
`finished_calibre_availability`, `useAvailableFinishedStock`), `attribute_chiqim_line_fifo`,
the overdraw trigger, `mint_serial_from_sources` (whole-pallet eligibility: weight − departed −
drawn > 0), `rahbar_dashboard_ledger` (Ledger C) and `get_client_report` (both in `0143`: a
draw is its **own outflow**, `finished.rezkaDrawnKg`, a third branch in the `pallets` union;
produced and dispatched unchanged, closing = opening + produced − dispatched − rezkaDrawn).
Not affected, with reason: `kirim_line_state` / `kirim_line_report_bundle(_set)` (their
`olib_ketilgan` is departed dispatches; Hisobot has no finished-remaining serial-state column,
and "Moykadan chiqgan" stays the full produced amount — the audit's D2 "partly confirmed" is
now confirmed: `kirim_line_state` excludes only `bekor_qilindi`/`storage_loss`),
`client_serial_ledger`, `client_filtered_report_rows`, `report_chiqim_rows(_v2)`,
`report_moyka_output_rows`, `client_chiqim_ledger`, `chiqim_request_loaded_kg` (dispatch reads);
`close_out_old_stock` / `old_stock_closeout_lines` (draws exclude old stock).

**Deviation from the brief, stated plainly.** The brief listed "Hisobot serial-state columns"
and `get_serial_passport` as sites to patch. Neither computes a finished remaining of its own:
Hisobot's serial-state columns are raw/Moyka/departed figures, and the passport's
finished-still block reads `stock_on_hand_rows` (patched). Both inherit the change; neither
needed a body edit. The passport's own Rezka lines are Prompt 4.

**Verified** in one live `BEGIN … ROLLBACK` (values in `0222`): a 25 kg draw from two 720 kg
TEST- pallets wrote one ledger row (25 kg, oldest pallet), left 1,415 kg available, sent
25 kg, left both pallets `in_stock` at 720 kg; a 2,000 kg draw was rejected
("585.0 kg yetishmayapti") and rolled back; Ledger C: rezkaDrawnKg 25, produced +1,470,
dispatched +0, closing +1,445.
