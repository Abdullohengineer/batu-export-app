## 2026-08-28 — Six-serial output correction ("mixed up first fix loads") + 110826-001 finalized

User provided a corrected final-calculations table (screenshot) for 6 serials — per-serial totals
for Incoming/K2/K4/KN/K8/Loss — saying the first pass had "mixed up" loads, and asked for every
output number rewritten to match, plus 110826-001 (stuck, wouldn't Tugallash) force-completed and
added to finished storage with its own numbers from the same table.

**Verified the table's own internal consistency before touching anything**: for every row,
K2+K4+K8+KN+Loss = Incoming, and Incoming matches this project's own `moyka_sends` total per
serial exactly (290726-068: 2,320; -069: 2,255; -070: 617; -072: 2,203; 280726-029: 2,218.4 —
table rounds to 2,218; 110826-001: 7,320) — the table is a real reconciliation against this
system's own raw-sent figures, not an independent guess.

**Investigated 110826-001's stuck Tugallash first, before forcing anything.** `handleTugallash`
(`OmborTayyorTab.tsx`) hard-blocks unless `currentLabStatus` (`labVerdict.ts`) reads `'passed'` —
requires a CHIQIM-scope `lab_results` row with the CURRENT `wash_cycles.id` and `verdict='o_tdi'`.
Checked directly: `wash_cycles.id` for this serial = `3759102c-...`, and a chiqim-scope
`lab_results` row exists with exactly that `wash_cycle_id` and `verdict='o_tdi'` (sampled
2026-08-26). The gate's own data is clean — nothing here explains a block. Likely a stale client
(the page not reloaded since the passing lab result landed, so `s.labStatus` was still showing
the pre-pass value) rather than a real data or RLS bug; not reproducible from this session (no
live browser). Proceeded with the user's explicit fallback instruction — write the same DB state
Tugallash itself would — rather than continuing to chase an unreproducible UI symptom.

**Correction applied as one transaction, per serial, mirroring the void-not-delete pattern
already established for the single-pallet fix earlier this session:**
1. Checked every existing pallet across all 6 serials (26 total) against `dispatch_manifest`/
   `chiqim_line_pallets`/`serial_mint_sources` first — 0 references anywhere, a clean correction
   with nothing downstream to reconcile.
2. Voided every `in_stock` `finished_pallets` row for these 6 serials (`status='bekor_qilindi'`,
   `voided_at=now()`), each with its own `audit_log` row (`before`: old weight/calibre/status,
   `after`: void + reason).
3. Inserted one new pallet per non-zero calibre per serial, matching the table exactly —
   consolidated (one pallet per calibre) rather than reproducing the original's arbitrary
   multi-pallet split, since the table only gives per-calibre totals, not a physical pallet
   breakdown; barcode2 continues each calibre's own existing numbering (e.g. `02-1` already
   voided → new one is `02-2`), never reusing a barcode string a voided row still holds. Same
   `created_by` as the original (real) receiving actor — the physical work was real, only the
   recorded numbers were wrong.
4. `wash_cycles.final_loss_pct` corrected for all 6 (`(sent − new_output) / sent × 100`, derived
   fresh from real `moyka_sends`, not hand-copied from the table's own rounded Loss column) —
   confirmed byte-for-byte against the table's own loss figures before applying (52/50/15/50/50.4≈50/166
   kg). `wash_cycles.status='final'` set unconditionally (a no-op for the 5 already-final serials,
   the actual fix for 110826-001) with `finalized_at = coalesce(finalized_at, now())` — preserves
   the 5 real original finalization timestamps, sets a fresh one only for 110826-001. Each
   `wash_cycles` update got its own `audit_log` row too.
5. One `notes` entry per serial (`entity_type='moyka'`), summarizing the correction and citing
   "mijoz tomonidan berilgan yakuniy hisob-kitob" (client-provided final calculation) as the
   reason — visible on the internal serial passport, not just in `audit_log`.

**Verification, real data, post-apply:** grouped-by-calibre sums for all 6 serials matched the
table exactly (`290726-068`: 430/1480/358; `-069`: 418/1439/348; `-070`: 114/393/95; `-072`:
407/1406/340; `280726-029`: 411/1415/342; `110826-001`: 1350/4657/1127/20). `wash_cycles`:
110826-001 now `status='final'`, `finalized_at` set (today), `final_loss_pct=2.27`; the other 5
kept their original `finalized_at`, loss corrected (2.24/2.22/2.43/2.27/2.27). Pallet counts:
3 `in_stock` (K2/K4/KN) + voided-count for the 5 K8-less serials, 4 `in_stock` (K2/K4/K8/KN) +
6 voided for 110826-001. Confirmed through the client portal's own RLS-scoped functions too, not
just as postgres: `client_serial_summary('110826-001')` (real client login's simulated session)
returns `byCalibre` 4657/20/1350, `knKg: 1127`, `lossKg: 166`, `washCycleStatus: 'final'` —
matching exactly, proving the client-facing screen reflects the correction correctly, not just
the raw tables.

No code change — pure data correction + one flagged-not-fixed UI observation (Tugallash's own
stuck state, likely a staleness issue, not chased further without a live browser).
