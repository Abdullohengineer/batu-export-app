# Rahbar dashboard: "Xom · yuvilmagan" hidden at Eski, de-duplicating the old-raw figure

## What changed

`0200` flagged, rather than silently fixing, that the new "Старое сырьё"
tile duplicated "Xom · yuvilmagan" at both Eski and Hammasi scope (same
`snapshot.rawKg` value, two labels). Resolved per explicit instruction
(option a):

- **Yangi**: "Xom · yuvilmagan" shown, new raw only. Unchanged.
- **Eski**: "Xom · yuvilmagan" now **hidden**; "Старое сырьё" is the only
  raw-material tile, showing the same `snapshot.rawKg` (which at this
  scope is already 100% old opening-stock material).
- **Hammasi**: "Xom · yuvilmagan" shown with the combined new+old total
  (`snapshot.rawKg` at `p_scope='hammasi'` is already unfiltered — no new
  arithmetic); "Старое сырьё" is hidden here, since Hammasi is meant to be
  a single aggregation view, not a place for a separate old-stock
  breakdown tile.

Net tile count: Yangi stays 5; Eski and Hammasi both now show 6 (previously
both showed 7, with the duplicate). Grid className simplifies back to a
plain `scope === 'yangi' ? 5 : 6` (no longer needs a distinct 7-column case).

## Client Панель — no change needed

Checked whether "the same pattern" (the duplication) exists there before
touching anything: it doesn't, structurally. The client's Склад toggle is
2-way only (no Hammasi/combined view) — "Сырьё · непромытое" and "Старое
сырьё" already live in mutually exclusive JSX branches
(`scope === 'eski' ? <old-tiles> : <new-tiles>`), so they were never
capable of rendering together in the first place. Updated only the
comment on the client's `oldRaw` tile (which had referenced Rahbar's
now-resolved duplication) — no functional change.

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` — all clean.
- Manually re-traced all three scopes' tile sets against the new
  conditionals (see above) to confirm the intended 5/6/6 split before
  committing.
