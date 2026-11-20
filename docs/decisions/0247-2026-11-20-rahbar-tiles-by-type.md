# 0247 — Rahbar dashboard: per-type lines under Jami / Xom / Moykada

2026-11-20 — Rahbar wants to see, under the big numbers of "Jami yuvilgan
va yuvilmagan mahsulot", "Xom · yuvilmagan" and "Moykada", how much of each
is Subxon / Natural / Isfara / etc.

- **Migration `0163`**: `rahbar_stock_snapshot_core` gains three keys,
  `rawByType`, `moykadaByType` and `finishedByType` (K1–K8 + KN, Rezka
  Standard excluded). They're built from the function's own CTEs, so each
  partitions exactly the rows its headline sums. No existing key changed.
  The new keys were inserted by asserted text replacement, so the rest of
  the body is byte-identical.
- **Jami per type** = raw + moykada + finished, summed in `RahbarHome.tsx`.
  That's the same composition as `derived.grandTotal`.
- `HeroTiles` gets an optional `breakdown` prop. The client Панель doesn't
  pass it and is unchanged.
- Lines follow the Zaxira scope (Yangi / Eski / Hammasi). They are not
  narrowed by the Turlar filter; neither are the headline tiles.

**Verified live, in a rolled-back transaction**, per scope, that the
per-type sums equal the headlines exactly:

| Scope | Raw | Moykada | Tayyor |
|---|---|---|---|
| Yangi | 52,297.2 | 4,948 | 59,800 |
| Eski | 2,880 | 0 | 10,760 |
| Hammasi | 55,177.2 | 4,948 | 70,560 |

Yangi Jami 117,045 = 52,297 + 4,948 + 59,800, matching the live screen.
Yangi split:
- raw: Natural 23,642 · Subxon 14,843 · Isfara 13,812
- moykada: Subxon 4,948
- tayyor: Subxon 38,560 · Natural 12,900 · Isfara 8,340

Build and 89/89 unit tests pass; not checked in a browser.
