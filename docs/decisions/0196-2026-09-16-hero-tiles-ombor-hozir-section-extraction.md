# HeroTiles/OmborHozirSection extraction from RahbarHome.tsx

## Why

The client Панель rewrite (next step) is required to mirror
`RahbarHome.tsx`'s hero tiles and "Omborda hozir" section against the same
`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` hooks (self-scoped via
RLS, no new RPC), explicitly forbidden from forking a parallel copy of that
JSX. `RahbarHome.tsx` wasn't factored for that reuse — the tiles, the
stock/dispatch re-slicing arithmetic, and the "Omborda hozir" block were
all local to one 370-line component. Approved as its own step
("HeroTiles + OmborHozirSection extraction — approved, Rahbar behavior
must be byte-identical after refactor") before the client rewrite.

## What moved where

- `src/lib/rahbarDashboardDerived.ts` (new) — `computeDashboardDerived()`,
  a pure function lifting the `isKn`/`sliceByType`/`regroupByCalibre`
  helpers and every derived stock/dispatch total
  (`stockByCalibre`/`stockKn`/`stockMax`/`stockCalibredTotal`/
  `stockKnTotal`/`stockTotal`/`dispatchedByCalibre`/`dispatchedKnRows`/
  `dispatchedMax`/`dispatchedKalibrliPeriod`/`dispatchedKnPeriod`/
  `grandTotal`) out of `RahbarHome.tsx`'s body. No React, no change in
  arithmetic — a straight lift. Shared so the client mirror can't
  independently re-derive (and drift from) the same re-slicing; in
  particular `stockTotal` will double as the client's own new "Эски
  ювилган" hero-tile value at Eski scope, and must never disagree with
  what "Omborda hozir"'s own prose sentence shows for the same figure.
- `src/components/rahbar/dashboardTheme.ts` (new) — the `C` color-token
  object and `fmt()` number formatter, both previously module-local to
  `RahbarHome.tsx`. Same hex values, verified byte-for-byte against the
  pre-extraction file (13 palette colors + the 2 "neutral" tone literals
  that stayed inline in `RahbarHome.tsx`'s own tone→style resolver).
- `src/components/rahbar/HeroTiles.tsx` (new) — a generic tile-grid
  renderer taking a `tiles: HeroTileConfig[]` array
  (`{key, label, value, unit?, caption, bg, fg}`). Deliberately holds no
  palette/tone logic and no Rahbar-vs-client branching of its own: each
  caller resolves its own label text, value, caption, and `{bg, fg}`
  before building the array. This was the one real design choice in the
  extraction — the alternative (a `variant: 'rahbar' | 'client'` prop
  baked into the component, hardcoding each variant's copy) was rejected
  because the client Панель's exact tile text/count per Zaxira-toggle
  state is a task-4 decision, not this task's to guess; a generic
  array-of-configs component lets task 4 decide its own copy without
  ever touching this file again.
- `src/components/rahbar/OmborHozirSection.tsx` (new) — the entire
  "Omborda hozir — kalibr bo'yicha" block (Turlar filter, stock bars,
  dispatched bars, both summary paragraphs) moved verbatim, parametrized
  only by data (ledger/snapshot-derived numbers, filter state), not text.
  Unlike `HeroTiles`, this one keeps its Uzbek copy hardcoded rather than
  going generic — the client-rewrite instruction names this section by
  its exact heading ("Same 'Omborda hozir — kalibr bo'yicha' section") as
  something to reuse as-is, and there's no structural variation needed
  (unlike the hero tiles, whose set genuinely differs by scope on the
  client side).
- `RahbarHome.tsx` — now a thin composition: builds its own 6-tile
  `HeroTileConfig[]` (via a small local `tileStyle()` tone→{bg,fg}
  resolver, moved unchanged from the old `Tile` component's ternary
  chain) and renders `<HeroTiles>` + `<OmborHozirSection>`, with its own
  filters/toggle/period-preset state and the Эski drill-down block
  untouched.

## Verification (byte-identical check)

Extraction only — no intended behavior change, so verified structurally
rather than just "it builds":

- Diffed every `className="..."` attribute between the pre-extraction
  file and the three post-extraction files as a sorted multiset: 47 vs 46,
  the one "missing" entry (`grid grid-cols-2 gap-3 lg:grid-cols-6`) is
  `HeroTiles`'s own default prop value, not a removed class.
- Diffed every literal string/hex color the same way: all 15 tile
  bg/fg colors present and unchanged (13 in the shared `C` palette + 2
  "neutral"-tone literals still inline); every label/caption string
  matches once quote-style differences are normalized (JSX
  `attr="..."` vs. object-literal `key: '...'`).
- `npx tsc -b` — clean.
- `npx oxlint` — clean, same 2 pre-existing warnings unrelated to this
  change (`FilterState.tsx`, `AuthProvider.tsx`).
- `npm run build` — clean, bundle size unchanged within noise
  (~1,862 kB → ~1,864 kB, expected from the file-split itself, not new
  code).

Not independently re-verified against live rendered DOM — this sandbox
cannot reach the live Supabase/Netlify hosts (confirmed via the agent
proxy's own 403 policy denial for those hostnames), so this relied on
source-level structural comparison rather than a browser screenshot diff.
