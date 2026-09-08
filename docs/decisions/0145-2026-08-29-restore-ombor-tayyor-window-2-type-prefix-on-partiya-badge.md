## 2026-08-29 — Restore Ombor Tayyor Window 2 + type-prefix on Partiya badge

Two bundled changes, both to §5.3/§2.17: restoring §5.3's second window (dropped by the 2026-08-28
single-tile receive picker redesign, "Section 3 single-tile receive picker" above) and extending
`PartiyaBadge` with a one-letter product-type suffix.

**(1) Window 2 restoration.** The 2026-08-28 redesign collapsed §5.3's whole per-serial card list
into one dashed-tile receive picker, and moved the only remaining per-serial output history
("Qabul qilingan palletlar") into a collapsible panel *inside* the receive sub-form — reachable only
while a serial happens to be selected there, with nothing persistent to look at otherwise. Restored
as a genuinely different window from the old pre-2026-08-28 "Tugallangan" Window 2 (there is still no
manual finish action, no locked `wash_cycles.status='final'` state, no Tugallash of any kind) — this
is a read-only history list, "2 · Qabul qilingan seriyalar", showing **every serial with any received
output**, not just serials currently in-Moyka.

That last point was the one real blocker: `useMoykaOutput()` built its `OutputSerial[]` array by
first filtering to `isInMoyka` (`sent > received`) — a serial that had been fully received (balance
at 0) was structurally excluded from the hook's own return value, never mind the UI. Fixed by moving
that filter out of construction and into two derived `useMemo` views over one unfiltered
`allSerials` array: `serials` (the existing `isInMoyka` filter, unchanged behavior for its two other
consumers — §5.2's Window 2 and OmborHome's dashboard count) and a new `receivedSerials`
(`s.pallets.length > 0`, no balance condition) for Window 2. Zero new database reads — same query,
same `refresh()`, both views recomputed from the same fetch.

Ordering needed a second fix: `finished_pallets.received_date` is `date`, not `timestamptz` — same-
day pallets have no ordering signal within a serial. `finished_pallets.created_at timestamptz` (added
migration 0087, the FIFO work) was already on the table but not selected by this hook; added to the
`.select()` and to `FinishedPallet`, used for both the outer serials list (`lastActivityDate`,
unchanged — already computed off the right timestamps) and the newest-first sort of pallets *within*
an expanded serial (new — the old collapsed history panel never sorted its own list at all, always
receipt-insertion order; this one does, per the universal sort rule, SPEC.md §5 intro).

Kept, per explicit confirmation: the intake sub-form's own "Shu seriyaga qabul qilingan" panel
(`ReceiveFromMoykaForm.tsx`) — in-flow visibility while actively receiving a serial — alongside the
new persistent Window 2 for at-a-glance/after-the-fact visibility. Two views of overlapping data
for two different moments, not a duplicate to collapse into one.

**(2) Partiya badge type-prefix.** `PartiyaBadge` rendered `P{n}` alone — a per-type counter that
reads identically across two different products' first arrivals (`P1` for Subxon's first delivery
and `P1` for Isfara's first delivery are visually indistinguishable, even though §2.17's own counter
is scoped per-type specifically so they're never confused *in the data*). Extended to `P{n}-{prefix}`
— `P1-S`/`P1-I`/`P1-N`/`P1-Q`/`P1-QQ` — a required second prop, `typeName: string | null | undefined`,
made required (not optional) so a missed call site fails `tsc`, not silently renders a bare `P{n}`
again. Live `product_types` queried directly before writing the mapping (CLAUDE.md schema-inspection
rule) — confirmed exactly 5, one category: Subxon, Isfara, Natural, Qand, **"Qand qizil"** (lowercase
"qizil" — the task text's own "Qand Qizil" casing does not match the live row and would have silently
fallen through to the `?` fallback had it been used verbatim). Mapping lives in one `TYPE_PREFIX`
constant inside `PartiyaBadge.tsx`; an unmapped type renders `P{n}-?` with a `console.warn`, never a
silent drop. Opening-stock/re-wash rows (`partiyaNo == null`) are unaffected — still no badge at all.
Display-layer only: no schema change, no new balance calculation, no new database read at any call
site — every site already had the type resolved (a local `typeName(id)` resolver, a passed-down
resolver prop, or an already-resolved string prop, per the codebase's existing convention) or gained
one trivially (`NewStockToMoykaForm.tsx` gained a `typeName` prop it previously had no need for).

~29 files, ~32 call sites threaded through, confirmed complete via a `grep` sweep for any
`<PartiyaBadge .../>` lacking `typeName=` (zero remaining).

**Extended to the client portal, on explicit instruction** ("inconsistency defeats the point of the
prefix"): `client_serial_summary` — the Global Export client portal's per-serial drill-down RPC — had
never selected `type_id` at all, so `ClientSerialSummaryModal.tsx` had no way to resolve a type name
for its own `PartiyaBadge`. Fixed with an additive migration
(`0099_client_serial_summary_type_id.sql`, applied live): `kl.type_id` added to the RPC's own already-
joined `owned` CTE and to its jsonb output — not a new read, not a new join, no `RETURNS TABLE`
signature-change restriction (the function is jsonb-returning, so plain `CREATE OR REPLACE FUNCTION`
applied cleanly, unlike the `text[]`-overload functions in the Partiya raqami/Hisobot output-by-kalibr
work). `ClientSerialSummary`/`ClientSerialSummaryDb` (`clientPortalReport.ts`) gained `typeId`;
`ClientSerialSummaryModal.tsx` gained a `useProductTypes(true)` + local `typeName(id)` resolver,
mirroring the sibling `ClientHisobotTab.tsx`'s own convention exactly, and its one `PartiyaBadge` call
site now passes `typeName={typeName(summary.typeId)}`.

**Verified:** `npx tsc --noEmit` and `npx tsc -b --noEmit` (via `npm run build`) both clean — the
build pass caught one real gap `--noEmit` alone missed: `ReceiveFromMoykaForm.tsx`'s local
post-submit state patch (§5.3's receive form keeps itself open after a save, splicing the new pallet
into local state ahead of the next `refresh()`) constructed a pallet object missing the new
`created_at` field, fixed by adding it there too (`new Date().toISOString()`, same pattern the
existing `received_date` line next to it already used). `npx oxlint` clean (one pre-existing unrelated
warning, `AuthProvider.tsx` fast-refresh). `npm run build` succeeds. `node --test`: 60/60, unchanged
— no new pure-function logic in this prompt to add unit coverage for (both changes are read/derive/
display wiring, not new computation).

**Not run this session:** browser/e2e verification of Window 2 and the badge prefix across roles —
same disclosed sandbox limitation as every prior prompt in this session (no `.env.test`, no real
login session obtainable here). Flagged, not silently skipped. Whoever picks this up next should spot-
check: Window 2 renders and expands correctly on a real in-Moyka serial with received output;  a
fully-received serial (in_moyka=0) still shows in Window 2 after its balance drops to 0 on the next
refresh; the badge prefix on one serial per product type (5 types) across at least Ombor Tayyor,
Hisobot, the serial passport, and the Global Export client portal per-serial summary — the last one
specifically, since it's the one surface this prompt added a live SQL read to.

**Out of scope, untouched:** §5.2 (Moykaga Chiqarish), loss display, Barcode #2 print/receive logic,
and `partiya_no` renumbering/backfilling — none of this touched by either change.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/global-export-profile-setup-t1hl6t`.
