# Deployment gap discovered; Fix 1 shipped; Fix 4 (2,880 kg "old raw") confirmed correct, no data bug

## Deployment gap discovered while triaging this round's bug reports

The user's "4 client Панель + Rahbar dashboard fixes" round included a
screenshot described as: 6 hero tiles, an "Отгружено со склада" card, and
a "Старый склад — подробно" heading. That is a byte-for-byte match to
`ClientPanelTab.tsx` **before** last round's rewrite
(`0197-...-client-panel-tab-rewritten-as-rahbarhome-mirror.md`) — the old
`client_panel_summary()`-backed screen, which has no Zaxira/Склад toggle
at all and no `OmborHozirSection`.

Checked: `origin/main` (`d7c973f`, 2026-09-19) does not contain
`src/components/rahbar/OmborHozirSection.tsx` or any file from last
round's extraction/rewrite work at all — confirmed with
`git cat-file -e origin/main:src/components/rahbar/OmborHozirSection.tsx`
(fails). No PR was opened for `claude/client-portal-rahbar-rebuild-bbruz8`
after last round finished (flagged at the time, never actioned), so
whatever the user has been testing — production or a preview — is running
pre-rewrite code that predates the entire Панель mirror, the extraction,
and the Расход per-truck rewrite.

This matters for two of this round's four fixes:
- **Fix 2** ("is `OmborHozirSection` being called from `ClientPanelTab.tsx`
  at all?") — on this branch, yes, correctly, at `scope === 'yangi'`
  (`ClientPanelTab.tsx:198-217`). The screenshot's absence of that section
  is fully explained by it looking at a version of the file that doesn't
  contain the component at all, not a rendering bug in the current branch.
  See the reply to the user for full detail — no code defect found, no fix
  needed for this item as filed.
- **Fix 1**'s "currently visible on all Zaxira toggle states" description
  matches `RahbarHome.tsx`'s actual behavior (unchanged between `main` and
  this branch — the extraction only moved this code, never changed its
  gating), so Fix 1 is a real, current bug independent of the deployment
  gap. Fixed below.

## Fix 1 — Старый склад Кондитерка tile hidden at scope='yangi'

`RahbarHome.tsx`: the 6th tile was unconditionally included in the
`HeroTiles` `tiles` array (deliberately scope-independent per migration
0120 — but that migration only made the *value* `oldKnKg` stop reading 0
at Yangi; it was never meant to make the *tile* itself always visible,
which is what actually shipped). Corrected: the tile is now built
conditionally (`...(scope !== 'yangi' ? [...] : [])`), hidden at `'yangi'`,
shown at `'eski'` and `'hammasi'`. Grid className switches between
`lg:grid-cols-5` (Yangi, 5 tiles) and `lg:grid-cols-6` (Eski/Hammasi, 6
tiles) so the 5-tile Yangi view doesn't leave an empty 6th slot.

**Interpretation flagged, not assumed silently:** the user's prose said
"appears ONLY when Zaxira = Eski," which read literally would also hide it
at `'hammasi'`. The explicit "Applies to" bullets underneath only say
"hide when Zaxira = Yangi" for Rahbar. Implemented the narrower, explicit
bullet (hide at Yangi only, keep at Eski **and** Hammasi) since Hammasi is
meant to show the totality of stock and the bullets are the operational
spec. Reported to the user for confirmation; a one-line change if Hammasi
should hide it too.

**Client Панель needed no code change for Fix 1** — `ClientPanelTab.tsx`'s
`scope === 'yangi'` tile set was already exactly 5 tiles with no `oldKn`
entry (the 6th tile only ever appears in the `scope === 'eski'` branch,
alongside Эски ювилган). This was correct from the original rewrite;
Fix 1 as filed against the client screen doesn't reproduce on this branch.

## Fix 4 — investigated, no data bug: the 2,880 kg is already-correct old stock

Traced every `stock_on_hand_rows` row in `bucket = 'raw_not_washed'`,
joined to its `kirim_lines`/`kirim_orders` for origin and date:

- **7 rows, 51,832 kg total, `is_old_stock = false`, `origin = 'delivery'`**,
  `order_date` ranging 2026-07-23 through 2026-09-17 (the most recent 2
  days before this check) — genuinely new intake. This is exactly
  `rahbar_stock_snapshot('yangi').rawKg` (51,832 kg).
- **1 row, 2,880 kg, serial `020826-039` ("Qand"/sugar), `is_old_stock =
  true`, `origin = 'opening_stock'`, `order_date = 2025-01-01`** — a
  legacy opening-stock seed row, not a recent delivery. This is exactly
  `rahbar_stock_snapshot('eski').rawKg` (2,880 kg).

**Conclusion: the 2,880 kg is genuinely old client raw material, and it is
already correctly excluded from the Yangi view and already counted under
Eski** via the existing `origin`/`is_old_stock` mechanism — no
misclassification, no filtering bug, nothing to change in how the number
is computed. Reported this as "not a bug" per the task's own third
possible outcome ("no change if all 2,880 kg is genuinely new" — inverted
here: it's genuinely *old*, and already on the *old* side).

**Real, narrower gap found and flagged (not fixed yet, pending approval):**
on Rahbar's dashboard this figure is still visible when Eski is selected —
it just shows up relabeled, under the same always-present "Xom ·
yuvilmagan" tile (which re-scopes with `scope`, unlike the 6th tile). On
the **client Панель's** Eski/Старое view, there is no raw tile at all (only
Эски ювилган + Старый склад Кондитерка) — so once this branch ships, a
client would have no way to see this 2,880 kg anywhere. Proposed a 3rd
Eski-view tile ("Старое сырьё") for the client screen only, matching the
user's own suggested remediation; reported to the user for approval before
implementing (explicit instruction: "report findings before implementing").

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` — all clean after Fix 1.
- Fix 4's numbers cross-checked twice: `rahbar_stock_snapshot('yangi'|
  'eski').rawKg` against the row-level `stock_on_hand_rows` sum for each
  `is_old_stock` value — exact match both ways (51,832 / 2,880).
