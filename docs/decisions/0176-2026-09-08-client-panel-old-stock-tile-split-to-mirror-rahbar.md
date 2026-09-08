## 2026-09-08 — Client Панель's combined "Старый склад" tile split to mirror Rahbar

**Context:** Follow-up to the previous entry's finding that `client_old_stock_breakdown()` has no
scope-toggle bug (it never took a scope parameter, so the bug pattern couldn't apply). Separately
requested: split the client Панель's single combined "Старый склад" hero tile
(`oldWashed.totalKg + oldKn.totalKg`) into two, matching Rahbar dashboard's tile structure "1:1" —
Эски ювилган (`oldWashed.totalKg`) and Старый склад Кондитерка (`oldKn.totalKg`), same color,
caption, and position as Rahbar.

**Decision:** Frontend-only change, no migration — both totals were already fetched via
`fetchClientOldStockBreakdown()` (already used, unchanged, by the `OldStockDrilldown` section
lower on the same page), just not yet rendered as separate hero tiles. `ClientPanelTab.tsx`'s
local `Tile` component gained an optional `caption` prop (only these two tiles use it; the
existing four stay exactly as they were, still caption-less) and the tile grid widened
`lg:grid-cols-5` → `lg:grid-cols-6`.

**Старый склад Кондитерка** is an exact counterpart to Rahbar's own 6th hero tile: same color
(`#78716c`, stone-gray — reused verbatim, it was already this screen's old "Старый склад" tile
color too), same caption pattern (Rahbar: "Hozirgi qoldiq · havzadan" → Russian equivalent "Текущий
остаток · из бассейна"), same position (last in the row on both dashboards).

**Эски ювилган has no literal Rahbar HERO TILE to mirror** — Rahbar only shows this figure as one
of the two Эski drill-down graphs, never as its own top-row tile — flagging this rather than
silently treating "same as Rahbar" as fully satisfiable. Color reuses the green
(`#059669`) `OldStockDrilldown.tsx`'s own "Эски (ювилган)" section already uses on *both*
dashboards (the drill-down section is shared, unchanged) — the same green Rahbar's own
"Tayyor · kalibrli" hero tile happens to use too, a collision Rahbar's page never has to face
(that tile and the Эski drill-down graph are never adjacent there). On the client page specifically,
this new tile sits next to "Готовая продукция," which already uses the same `#059669` — an
adjacency Rahbar's own layout doesn't have. Chose to keep the color anyway, prioritizing "same
color as the Эски ювилган concept already has on Rahbar's page" over introducing a color with no
precedent anywhere in the app; noted here rather than picked silently.

**Verification:** `npx tsc -b`, `oxlint`, `npm run build` all clean. Both totals re-confirmed live
in the previous entry's `client_old_stock_breakdown()` call (81,915 kg oldKn, 44,620 kg oldWashed
for the TEST client account) — this change only moves already-correct, already-fetched numbers to
two tiles instead of one combined tile; no new query, no new arithmetic.
