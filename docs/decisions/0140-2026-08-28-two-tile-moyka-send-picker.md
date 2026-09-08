## 2026-08-28 — Two-tile Moyka send picker

**Prompt:** redesign §5.2 Window 1 from the all-in-one card-per-serial layout to a two-tile
launcher — Yangi zaxira (raw serials with balance) and Eski zaxira (old washed pallets, existing
flow, relocated unchanged). The Yangi zaxira tile opens a picker: raw serials as tappable chips
(serial + available kg only, no company/type/kalibr dropdowns), select one, enter weighed kg,
confirm. UI-only — no schema change, no read-path change, `useMoykaSerials.available` as the sole
data source. Hard gate in the brief: render-tree diff (kept/replaced/relocated) + confirmation the
old-stock form embeds as-is, shown in one message before any code touched.

**Two premises in the brief didn't match the codebase — reported back before designing, per this
file's own "stop, report, do not invent a design" rule:**
1. **No "Rezka/Moyka pill" exists anywhere.** Grepped the whole `src/` tree — "rezka" appears only
   as data fields (`rezkaSent`, `rezka_sends`) in `useMoykaSerials.ts`/`serialPassport.ts`; the
   Rezka data layer (`0076_rezka_data_layer.sql`) has always been backend-only, 0 live rows, no
   frontend page/tab/toggle ever built (confirmed against this file's own prior Rezka entries).
   `OmborMoykaTab.tsx` had no pill or segmented control of any kind before this change. Nothing
   was preserved because nothing existed to preserve.
2. **No toast component/pattern exists anywhere in the app.** Grepped app-wide for `toast`/`Toast`
   — zero matches. The app's one existing success/error idiom is inline `StatusNote` plus the form
   collapsing on success (e.g. `OldStockToMoykaForm`'s `onSaved()`). User's call, offered as three
   options: **inline `StatusNote tone="ok"` ("Yuborildi."), shown ~1.5s, then auto-collapse** —
   matches the existing idiom exactly, introduces no new UI primitive in a UI-only prompt scoped
   to one tab.

**Two further calls, made by the user after the investigation (not invented):**
3. Row-level detail the redesign has no room for — per-serial send history, Qaydlar, and the
   `§2.15.2` provisional-variance warning — **dropped outright**, not relocated. Not asked for by
   the brief's own picker shape (image 3/4 in the design brief).
4. `MoykaSendForm.tsx` — the old per-row send form — **deleted**, not left in place. It became
   fully dead (only caller was the row list this redesign replaces) and its own behavior actively
   conflicts with the new requirement (it blocks over-send; the picker must allow it), so keeping
   it around wouldn't even serve as a future reference for the same shape.

**Investigation, before writing any code:**
- `OldStockToMoykaForm.tsx` confirmed embeddable as-is — already takes exactly `{ onCancel,
  onSaved }`, fully self-contained. Zero prop/wrapper changes; Tile 2 just relocates the existing
  `oldStockOpen ? <OldStockToMoykaForm/> : <Button.../>` pair.
- Dashed-tile pattern located via grep (not guessed): `border border-dashed !border-amber-400
  !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400
  dark:hover:bg-amber-950/30` on a `Button variant="ghost" size="md" fullWidth`. Reused verbatim
  for both tiles — same amber color on both, per "look identical," not a differentiated color per
  tile.
- `MoykaSendForm.tsx` couldn't be reused for the new sub-form: it pre-fills from `available` and
  **blocks** over-send (`overSend` → submit refused), the opposite of this prompt's explicit
  requirement. The requested copy ("Kitob bo'yicha (1 ta seriya): ~X kg" + an empty, uncapped
  weight input) instead mirrors `OldStockToMoykaForm`'s own shape (book figure as plain-text
  reference, weight input starts empty, never capped) — built as a new sibling component,
  `NewStockToMoykaForm.tsx`, following that precedent rather than `MoykaSendForm`'s.
- One deliberate section-mirroring deviation, flagged rather than silently applied: the new chip
  list's membership (`available > 0`) differs from §5.1's own Window 2 predicate (`hasRawRemainder`,
  which ignores raw-dispatch/rezka draws) — the brief explicitly asked for `available`, which is
  the more correct figure now that those exits exist, but this does mean §5.1 W2 / §5.2 W1 no
  longer mirror byte-for-byte at this one boundary (every other section-mirroring boundary in the
  app is unaffected).

**Implementation:**
- `src/pages/ombor/NewStockToMoykaForm.tsx` (new) — chip list (`serials.filter(s => s.available >
  0)`), single-select, sub-form (plain-text `available` reference + mandatory empty weight input,
  no cap), inline `StatusNote tone="ok"` on success with a 1.5s `setTimeout` before calling
  `onCancel` to collapse. Props mirror `OldStockToMoykaForm`'s shape (`onCancel`) but pass the
  selected `MoykaSerial` back through `onSubmit(serial, qtyKg)` since selection happens inside
  this component, not the parent.
- `src/pages/ombor/OmborMoykaTab.tsx` — Window 1's per-serial `row()`/`serialDetail()` and the
  `activeSerial`/`expanded` state removed; replaced with a single `expandedTile: 'yangi' | 'eski' |
  null` state (mutual exclusion and the `null`-default cold-load requirement both fall out of using
  one variable, no extra logic needed) driving the two tiles. `handleSend`'s body (the
  `wash_cycles` upsert + `moyka_sends` insert) is byte-for-byte unchanged — only the UI calling it
  changed, and it now just calls `refresh()` instead of also clearing the deleted `activeSerial`
  state. Window 2 ("2 · Moykada") untouched.
- `src/pages/ombor/MoykaSendForm.tsx` deleted.
- Three e2e specs drove the old per-row send flow and needed adapting to the tile/chip flow (not
  deleted — same treatment as the previous prompt's affected specs): `tests/e2e/lab-packing-hard-
  gate.spec.ts`'s `sendToMoyka()`, `tests/e2e/full-chain.spec.ts`'s Subxon-send block, and
  `tests/e2e/lab-relocation-loss-verification.spec.ts`'s send block — all three now click the
  Yangi zaxira tile, select the chip by serial (`getByRole('button', { name: /^SERIAL\b/ })`), fill
  `#new-stock-weighed`, and wait on the real `moyka_sends` POST response rather than a button-
  label/visibility change (matching this suite's own established convention for that exact race).

**Verified:** `npx tsc -b --noEmit` clean; `node --test` suite passes; `npx oxlint` clean on every
touched/new file; `npm run build` succeeds. No live-browser Playwright run this session (same
network-policy limitation as prior client-portal/Moyka-loss work) — the three adapted e2e specs
are updated for correctness but not run.

SPEC.md §5.2 amended inline (struck the old per-row Window 1 description and the stale pre-0086
Tugallash-based Window 2 description — the latter had been missed by the 2026-08-28 "Moyka loss
becomes live" entry's own SPEC pass and is corrected here) — not rewritten wholesale.
