## 2026-09-27 — Missed Moyka output added after close, Natural P-2 (console data fix)
- Serial 110926-001 (Natural, partiya 2) was closed 2026-09-25 with output under-recorded.
- Added two new finished_pallets rows (existing barcodes untouched):
  - PLT-110926-001-06-2: K6, 200 kg
  - PLT-110926-001-KN-2: Konditerka, 220 kg
- received_date = 2026-09-25 (original output day); created_at = time of fix.
- Serial output 4,470 → 4,890 vs 4,570 sent: loss 100 kg → surplus 320 kg (−7.0%).
- Applied via SQL; audit_log action = 'manual_missed_output_add', actor null.
- Known gap: no in-app way to add output to a closed serial. If this recurs, build a proper Ombor action (receive-after-close) instead of console edits.
