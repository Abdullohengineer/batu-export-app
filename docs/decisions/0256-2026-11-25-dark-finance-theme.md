# 0256 — Dark finance theme (aesthetics only)

2026-11-25. The owner's brief: match the dark mockup artboards (Overview,
CategoryDetail, Main, OyniYopish) for Moliyaviy ko'rsatkichlar and
Buxgalteriya. Aesthetics only: no route, query, table or feature changes.

## Scope

- **Where it applies.** `AppNavShell` sets `data-theme="dark-finance"` on its
  root for `/buxgalter/*` and every `/<role>/moliya/*`. Every other screen
  is untouched; verified that Rahbar's Hisobotlar renders without the
  attribute.
- **How the existing styles switch over** (`src/index.css`):
  - the `dark` variant matches **either** the OS dark preference (unchanged
    behaviour app-wide) **or** "inside `[data-theme=dark-finance]`". So every
    existing `dark:` style turns on in the finance screens and nowhere else;
  - under the selector, Tailwind's palette and radius variables are
    remapped onto the brief's tokens (`--bg`, `--surface`, …,
    `--accent-*`), so the existing utilities paint the mockup colours;
  - the inverted "selected / primary" pattern becomes the mockup's violet
    (gradient primary button, solid selected pills). The active nav item is
    an elevated surface with a violet marker: on the left for the side nav,
    underneath for the Buxgalteriya tabs;
  - Inter (400/500/600/700) is loaded from Google Fonts and applied only
    inside the scope.
- **Cards.** `Card` gains a neutral `ui-card` class. Only the finance scope
  styles it (surface background, 14px radius). It sits in the components
  layer, so tinted cards keep their tint.

## Checklist from the brief

1. **Compact numbers.** `formatCompact` (`Intl.NumberFormat` compact) is
   used on tiles, chart axes and balances. Full precision stays in tables
   and entry lists.
2. **Semantic colour.** Negative is pink and positive teal on sof foyda and
   the Oyni yopish figures and table. Deltas are pills, teal for a good
   change and pink for a bad one; for cost per kg and for category spend,
   "up" is bad.
3. **Tiles** (`FinanceUI.Tile`): surface, 1px border, 14px radius, 20/22px
   padding, an 11px uppercase label with 0.8px tracking, a 28px/600 number,
   and a 12px stats row.
4. **Period chip:** 1.5px teal border, teal dot, and a muted suffix:
   `joriy` (current month), `tugallangan` (closed) or `ochiq`. An invisible
   native `<select>` sits on top, so keyboard, screen-reader and tests work
   unchanged.
5. **Status pills:** the ochiq / tugallangan / warning tints come from the
   palette remap (amber, emerald, red) plus `FinanceUI.Pill`.
6. **Xarajatlar tarkibi is now a donut.** It is an SVG with
   `stroke-dasharray` and `pathLength=100`, rotated −90°, 200px, 32px
   stroke, with "JAMI" and the total in the centre. It shows at most 5
   slices: the top 4, plus "Boshqa (N ta)". The legend rows link to
   CategoryDetail; "Boshqa" isn't a single category, so it doesn't link.
7. **Balanslar** is a 2×2 grid of mini tiles. Utility accounts get a runway
   bar coloured green for ≥3 months, orange for 1–3 and pink for <1, plus
   the "~N oy" badge.
   **Deviation:** the bar's full width means **3 months** of cover. Read
   literally, "balance ÷ monthly use, capped at 100%" fills the bar for
   anything at or above 1 month, so it would almost always be full.
8. **Kutilayotgan:** each item is its own inner tile (`--bg`, 10px radius)
   with a per-day pill. Zahira tavsiyasi sits in a teal-tinted tile.
9. **Entry rows** (CategoryDetail and Tarix): 14px rows, bottom border, no
   zebra striping, and a 28px tinted icon with 2-letter initials. The
   category colour is stable per id; tushum rows are teal and transfers
   orange.
10. **CategoryDetail bars:** a vertical gradient (solid top fading to 40%),
    with the other months at 60% opacity. The selected month's label and
    value are bold.
11. **Overview "Tushum va xarajat" is a dual line.** It has gradient areas
    (35% fading to 0), hollow points, a dashed guide and a tooltip card at
    the active month. The other tabs stay bars or stacked bars.
12. **View pills:** 999px radius. Active is `--surface-elev` with a
    `--border-strong` border; inactive is transparent with muted text.
13. **Spacing:** 16px gaps between cards, 24px between sections, 20–24px
    padding inside cards.
14. **Palette order** for slices, bars and stacked types: expense, income,
    utility, warning, then greys (`FIN_PALETTE` in `src/lib/financeTheme.ts`).

The Main (Xarajat) and OyniYopish artboards are matched through the token
remap and the violet primary/selected styles; their layouts already followed
the mockups.

## Phone

At 390px: tiles stack, the donut sits above its legend, and balances stay
2×2. Narrow charts switch to short month names (Iyun and Iyul keep 4
letters so they stay distinct).

## Verification

- Build passes; 108/108 unit tests (new: `formatCompact`); oxlint clean; RPC
  check OK.
- UI suites against the fake backend:
  - Moliya 32/32 (number assertions updated to the compact format);
  - Oyni yopish / Kutilayotgan 36/36;
  - Tarix 14/14;
  - Rahbar/Menejer read-only 14/14.
- Desktop (1440) and phone (390) screenshots of Overview, CategoryDetail,
  Xarajat, Oyni yopish and Tarix were compared against the artboards. No
  page errors.
