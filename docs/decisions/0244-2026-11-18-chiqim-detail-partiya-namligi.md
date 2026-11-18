# 0244 — CHIQIM request detail: partiya + CHIQIM namligi per pallet

2026-11-18 — Hisobot → CHIQIM (tayyor mahsulot) → "So'rov tafsilotlarini
ko'rish" (`ChiqimRequestDetail.tsx`) now shows each pallet's partiya badge
(`P12-N`, the existing `PartiyaBadge` format, kept on request) and its
serial's CHIQIM namligi next to the serial.

- Source: `kirim_lines.partiya_no` and `lab_results` (`scope = 'chiqim'`),
  read per serial by the new React Query hook
  `src/lib/useSerialPartiyaMoisture.ts`. No migration, and the formulas are
  unchanged.
- **Resolved ambiguity:** a serial can carry several CHIQIM tests. Live data
  has up to 25 per serial, from re-tests and several wash cycles. The
  passport shows the latest test per wash cycle. This shows the serial's
  **latest test overall** (by `created_at`), as decided with the user. For a
  serial washed more than once, earlier cycles' values are not shown here.
- Also fixed: `ChiqimDispatchRowDetail.tsx` (Hisobot's inline expanded table)
  already rendered `<PartiyaBadge partiyaNo={null}>`, so its badge never
  appeared. It now gets the real partiya from the same hook.
- `ChiqimRequestDetail` is also used by Menejer's "Yuborilgan CHIQIM
  so'rovlari" list, which shows the same additions.
