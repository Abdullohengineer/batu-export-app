# Fix 3 (Эski per-type breakdown), Fix 4 (Старое сырьё tile), PR #161 opened

## PR opened

Per explicit priority request: merged `origin/main` into this branch and
opened `#161` (a placeholder PR had already been auto-created for this
branch head with no title/body — updated in place rather than creating a
second one). `main` had moved on substantially (the "Path E" multi-cycle
`wash_cycles` work) since this branch's base — checked before merging:

- `git merge-tree` showed exactly one real conflict (`docs/SPEC.md`'s
  changelog table — both branches had inserted new rows using version
  numbers 1.51/1.52/1.53); every other touched file (`useLaboratorChiqim.ts`,
  `useMoykaOutput.ts`, `useReportQuery.ts`, `OmborMoykaTab.tsx`,
  `OmborTayyorTab.tsx`, `HisobotTab.tsx`, several new migrations/decisions)
  merged automatically with no conflict, since this branch never touched
  any of them.
- Before resolving, checked whether `main`'s Path E changes to
  `rahbar_stock_snapshot`/`rahbar_dashboard_ledger` (the two RPCs this
  branch's entire Панель rewrite depends on) changed their JSON output
  shape, since those functions were live in the database throughout this
  branch's own work and got rewritten out from under it. Fetched both
  functions' current `pg_get_functiondef`: JSON keys unchanged in both
  (`rawKg`/`finishedCalibredKg`/.../`byCalibre` for the snapshot;
  `period`/`raw`/`moykadaSnapshot`/`moyka`/`finished`/`byCalibreType`/`chart`
  for the ledger) — only internal computation is now cycle-aware
  (`moykadaKg` delegates to `kirim_line_moyka_asof`, `moyka_opening_total`
  uses per-cycle windows). No frontend changes needed for compatibility.
- Resolved the SPEC.md conflict by renumbering this branch's three
  changelog entries to sit after `main`'s (1.51→1.54, 1.52→1.55,
  1.53→1.56) rather than renumbering `main`'s already-shipped entries;
  updated every cross-reference to the old numbers in the same pass
  (`grep` confirmed none left).
- `npx tsc -b`/`npx oxlint`/`npm run build` clean on the merged tree before
  committing the merge.

## Fix 3 — Эski (ювилган) per-product-type breakdown

Added `stockByType: TypeKgRow[]` to `computeDashboardDerived()`
(`src/lib/rahbarDashboardDerived.ts`) — a `regroupByType` helper parallel
to the existing `regroupByCalibre`, summing the exact same
`snapshot.byCalibre` rows (both numbered and KN calibres combined, matching
what `stockTotal` already represents) by `typeId` instead of `calibreId`.
No new RPC or migration — a pure client-side re-slice of data already
fetched, same pattern the file's own header comment describes for the
existing calibre view.

`OldStockDrilldown.tsx`'s "Эski (ювилган)" `Section` gained an optional
`byType` prop: when present and non-empty, a divider + "По видам сырья"
sub-heading + a second, independently-scaled `HorizontalBar` stack renders
directly below the existing per-calibre stack, within the same card
(option (a), as specified) — both stacks share the same `totalKg` for
their percentage labels, since they're two slicings of one number, not two
different totals. "Старый склад Кондитерка"'s card is unchanged (it was
already by-type).

`RahbarHome.tsx` and `ClientPanelTab.tsx` both gained a `typeName(id)`
helper (mirroring the existing `calibreLabel(id)`) and an
`oldWashedByTypeSeries` derived value, passed to `OldStockDrilldown` as
`oldWashedByType`. Applied identically to both dashboards, per instruction.

## Fix 4 — Старое сырьё tile added to both dashboards

Confirmed in `0199`: the 2,880 kg is genuine, correctly-classified old raw
material (`origin='opening_stock'`), already excluded from Yangi's
`rawKg`. Added a dedicated tile naming it as such, on both screens, gated
identically to the 6th tile (hidden at Yangi, shown at Eski/Hammasi):

- `RahbarHome.tsx`: 7th tile, `label: 'Старое сырьё'`, `value:
  snapshot.rawKg`, tone `'raw'` (same amber as the always-present "Xom ·
  yuvilmagan" tile, since it's still conceptually raw material). Grid
  widens to `lg:grid-cols-7` at Eski/Hammasi (was 6).
- `ClientPanelTab.tsx`: 3rd tile in the Старое tile set (alongside Эски
  ювилган + Старый склад Кондитерка), same value/tone. Grid widens to
  `lg:grid-cols-3`.

🚩 **Flagged, not silently resolved:** on Rahbar's dashboard this means the
identical kg figure now appears twice at Eski/Hammasi scope — once as
"Xom · yuvilmagan" (unchanged, still always-present, re-scopes with
`scope` like it always has) and once as this new "Старое сырьё" tile. Only
adding a tile was asked for, so "Xom"'s own visibility was left untouched
rather than assumed hideable at those scopes; a one-line follow-up
(`...(scope !== 'yangi' ? [] : [<xom tile>])`, inverted from the 6th
tile's own gating) if the duplication should be removed instead. The
client screen has no such duplication (it never showed old raw anywhere
before this).

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` — all clean.
- Fix 3's arithmetic cross-checked by hand against the same
  `stock_on_hand_rows` data pulled during `0199`'s investigation:
  snapshot_eski's 6 `byCalibre` rows (all non-KN) regroup to Isfara
  25,520 kg + Subxon 6,290 kg + Qand 1,270 kg = 33,080 kg, matching
  `stockTotal` exactly.
- Not independently verified against a live rendered DOM (same sandbox
  limitation as every prior round this session).
