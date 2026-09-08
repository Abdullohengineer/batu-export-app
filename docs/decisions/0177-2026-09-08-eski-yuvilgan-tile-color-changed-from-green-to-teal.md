## 2026-09-08 — Эски ювилган tile: green swapped for teal, closing the adjacency the previous entry flagged

**Context:** The previous entry split the client Панель's combined old-stock tile into two,
flagging (not silently resolving) that "Эски ювилган"'s color choice (`#059669`, reused from
`OldStockDrilldown.tsx`'s own green for the same concept) collided with the adjacent "Готовая
продукция" tile, which already used that exact green — an adjacency Rahbar's own dashboard doesn't
have to face. Follow-up instruction: pick a distinct, non-green color instead.

**Decision:** `#0d9488` (teal) — visually distinct from every other color already in this specific
tile row (`#0f172a` slate, `#d97706` amber already on "Сырьё", `#0369a1` sky, `#059669` emerald on
"Готовая продукция", `#78716c` stone on "Старый склад Кондитерка"), and not itself a shade of
green. `OldStockDrilldown.tsx`'s own "Эски (ювилган)" graph color is deliberately left as its
existing green — that component is shared with Rahbar's dashboard, which has no adjacency problem
to fix, and recoloring it would ripple an unrequested visual change into Rahbar's own page. The
resulting minor inconsistency (this hero tile is teal; the drill-down detail directly below it on
the same page, for the identical total, is still green) is accepted as the cost of a scoped fix
rather than an unrequested one — noted here so it reads as a deliberate choice, not an oversight.

Recorded for reuse: `#0d9488` is now this app's established "Эски ювилган hero tile" color,
per explicit instruction — if Rahbar's own dashboard ever gains an equivalent hero tile (it
currently has none, only the drill-down graph), it should reuse this same color rather than an
independently picked one.

**Verification:** `npx tsc -b`, `oxlint`, `npm run build` all clean. Single-line color change, no
data/query impact.
