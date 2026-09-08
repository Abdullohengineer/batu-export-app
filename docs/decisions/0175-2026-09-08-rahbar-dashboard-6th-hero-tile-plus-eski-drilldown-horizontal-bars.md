## 2026-09-08 — Rahbar dashboard: 6th hero tile (always-visible old-KN) + Эski drill-down horizontal bars

**Context:** Two requested changes to the Rahbar dashboard, shipped together per instruction. (1)
The existing Konditerka (KN) tile shows 0 kg in the default Boshidan/Yangi view because it counts
new-production KN only — the old-stock KN pool (81,915 kg live) has no tile of its own outside the
Eski-scoped drill-down, so it's effectively invisible to anyone not specifically toggling Eski.
Requested: a 6th hero tile showing that pool's live total, visible on every Zaxira toggle state
(Yangi/Eski/Hammasi), since it's real client stock regardless of which scope is selected. (2) The
Эski drill-down's two `recharts` bar charts (Эски ювилган / Старый склад Кондитерка) should be
replaced with the same horizontal-bar-per-row visual already used by "Omborda hozir — kalibr
bo'yicha" (kg + % of section total, header with total kg in large font).

**Decision — tile:** Added as a 6th `<Tile>` in `RahbarHome.tsx`'s hero-tile grid (`lg:grid-cols-5`
→ `lg:grid-cols-6`), reusing `Tile`'s own `tone="oldKn"` — a stone-gray tone the component already
declared in its type union but had never actually used for a tile, evidently reserved for exactly
this (it already matches `OldStockDrilldown.tsx`'s existing old-KN color). Deliberately distinct
from Konditerka (KN)'s purple, since new production and an old-stock pool are genuinely different
things that happen to share the "KN" name — the existing Konditerka (KN) tile is untouched, sitting
alongside this one, not replaced. Unlike the drill-down section below it, this tile is **not**
gated by `scope === 'eski'`.

Making it actually read the same number on every toggle needed a backend fix, not just an
unconditional render: `rahbar_stock_snapshot`'s `old_kn_total`/`old_kn_by_type` CTEs previously
selected from `scoped` (`stock_on_hand_rows` filtered by `p_scope`), and old-KN rows are
structurally always `is_old_stock = true`, so they silently vanished at `p_scope = 'yangi'` (read
0 kg) even though the real balance never changed. `supabase/migrations/
0120_rahbar_old_kn_scope_independent.sql` changes both CTEs to select from `stock_on_hand_rows`
directly, unfiltered by scope. Verified live before and after: identical 81,915 kg at
`p_scope='eski'`/`'hammasi'` (old-KN rows were never actually excluded by the scope filter at
either of those — confirmed empirically, not just by reading the WHERE clause), and 0 → 81,915 kg
at `p_scope='yangi'`, the only case that changes. `totalKg` (an existing jsonb field on the same
function, confirmed via grep to be unused anywhere in the frontend — `RahbarHome.tsx` computes its
own separate `grandTotal`) picks up the same change incidentally; no visible effect anywhere.

**Decision — horizontal bars:** `RahbarHome.tsx`'s own local `Bar` component (the exact row visual
already used for "Omborda hozir") was extracted, unchanged, into `src/components/ui/
HorizontalBar.tsx` so `OldStockDrilldown.tsx` could use the identical component rather than a
second bespoke implementation — the "reuse, don't rebuild" answer to the task's own "reuse if
factorable" instruction. `OldStockDrilldown.tsx`'s `Graph` (header + recharts `<BarChart>`) is
replaced with `Section` (the same header markup, unchanged, + a `space-y-2.5` stack of
`HorizontalBar` rows), computing `max` from the series' own kg values and `pctOfLabel` as
`kg / totalKg` — the same percent-of-section-total convention "Omborda hozir" already uses. The
component's exported prop shape (`OldStockDrilldownProps` — `oldWashed`/`oldKn`, each
`{totalKg, series}`) is byte-for-byte unchanged, so `ClientPanelTab.tsx` (§3.6's Панель tab, the
component's other caller) needed zero changes and picks up the same visual automatically.
`recharts` was confirmed (via `grep -rl recharts src/ package.json`) to have exactly one caller —
`OldStockDrilldown.tsx` — so it was removed from `package.json` entirely (`npm install` to update
the lockfile), dropping ~370 kB (minified) / ~578 transformed modules from the production build.

**Flagged, not extended:** the client portal's own old-stock view (`ClientPanelTab.tsx`) reads a
*separate* RPC (`client_old_stock_breakdown`/`client_panel_summary`, migration 0113), not
`rahbar_stock_snapshot` — the scope-independence fix above does not reach it. The task's own
framing ("client dashboard mirrors Rahbar... appears there too automatically") doesn't quite hold
here since the two dashboards diverge at the RPC layer; left alone since it wasn't part of this
request, but the client dashboard would need its own equivalent fix if an analogous "always
visible regardless of filter" requirement applies there too.

**Verification:** `npx tsc -b`, `oxlint`, `npm run build` all clean. `rahbar_stock_snapshot`'s new
behavior re-verified live across all three scope values (`yangi`/`eski`/`hammasi`) before writing
the tracked migration file. No live browser confirmation possible in this sandboxed session (same
egress-policy block prior entries in this log describe) — recommend a manual look at the dashboard
before merging, same as this log's other flagged UI changes.
