# 0258 — Slate palette; full amounts in the top tiles

2026-11-25, owner. Follows 0257. Colours and number formatting only; layout
and components are unchanged.

## Slate palette (lighter than 0257's near-black)

| Token | Value |
|---|---|
| `--bg` (main) | #111827 |
| `--sidebar` (new; side nav, mobile header, drawer) | #0F172A |
| `--surface` (cards) | #1E293B |
| `--surface-elev` | #263449 |
| `--border` | #334155 |
| `--border-strong` | **#475569** |
| `--text-primary` | #F8FAFC |
| `--text-secondary` | #CBD5E1 |
| `--text-muted` | #94A3B8 |
| Turquoise (income) / purple (expense) | #2DD4BF / #A78BFA, unchanged |
| Warning / critical | unchanged |

- `--border-strong` was not specified; #475569 is the next slate step above
  `--border`.
- The mockup's glows and gradients are deliberately **not** added.

**WCAG:** every text level passes AA on every surface.
- Muted is 6.9 on bg, 5.7 on cards and 4.9 on elevated cards; the old muted
  was 3.8 on elevated cards.
- Secondary is at least 8.5; primary at least 12.
- Dark ink on the violet button is 7.0.

## Top numbers in full

Owner: "top numbers shouldn't be rounded — give it as a whole, to the cents."

- **Full so'm with no compaction:** Overview tiles (cash total, bank,
  kassa, sof foyda, tushum, xarajat), CategoryDetail tiles (jami,
  6-month average, change) and the Oyni yopish period figures.
- **Per-kg values get 2 decimals** (new `formatPerKg`): 1 kg tannarxi,
  marja, and the rate 7,468.75, since they really are fractional.
- **No tiyin.** Amounts are stored as whole so'm (`bigint`), and the
  Aug–Oct import rounded each row (decision 0254). Today's bank balance is
  therefore 8,479,103, not the statement's 8,479,103.51, and printing
  ".00" would be false precision.
- **Still compact:** chart axes, donut, balance mini tiles and obligation
  pills.

## Verification

- Build passes; 108/108 unit tests; oxlint clean; RPC check OK.
- UI suites: Moliya 33/33, Oyni yopish 36/36, Tarix 14/14, read-only roles
  14/14. Assertions were moved to full amounts.
- The chart = tile regression check now compacts the tile's exact value and
  compares it cell by cell: 47,600,000 → 47.6M and 29,400,000 → 29.4M. The
  previous version could pass on a partial match.
