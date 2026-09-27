## 2026-09-27 — Manual K1→K2 recalibre, Subxon (console data fix)
- 270 kg of Subxon was physically re-sorted from Kalibr 1 to Kalibr 2 on the floor.
- Booked entirely inside serial 210826-001 for convenience (not necessarily the physical source):
  - PLT-210826-001-01-1 (K1): 1080 → 810 kg
  - PLT-210826-001-02-1 (K2): 1440 → 1710 kg
- Serial total unchanged (6,940 kg) → loss/yield/Moykada unaffected; only per-calibre split changed.
- Subxon K1 on new serials: 2,880 → 2,610 kg (old-stock PLT-020826-034-01-1, 30 kg, untouched).
- Applied directly via SQL (no app UI exists for recalibration). Two audit_log rows, action = 'manual_recalibre_k1_to_k2', actor null (console fix).
- Known gap: no in-app recalibration path. If this recurs, build a proper Ombor/Menejer action rather than repeating console edits.
