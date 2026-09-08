## 2026-08-30 — Konditirskiy → Konditerka (display only), and the printed-label defect it exposed

**Inventory before touching anything** — 404 occurrences, split by kind:

| Kind | Count | Action |
|---|---:|---|
| Identifiers: `konditirskiyKg` (53), `konditirskiy_kg` (192), `konditirskiy_total` (42), `live_konditirskiy_kg` (27), `finished_konditirskiy_total` (21), `processed_konditirskiy_total` (21) | ~356 | **Left alone** — DB↔frontend contracts |
| Display strings (frontend) | 9 | Renamed |
| `calibres.label` where `code='KN'` | 1 row | Renamed |
| Code comments | 8 | Left — not display text |
| SPEC.md / DECISIONS.md | 89 | Left — historical record |

Renamed: `clientReportLabels.ts` (uz `Konditerka`, ru `Кондитерка`), `CalibresSection.tsx`,
`OldKnRowDetail.tsx`, `RahbarHome.tsx` (×3), and the two Laborator forms' prose listing the
calibre set. `calibres.code` is untouched.

### The defect the rename exposed, and why the fix is not a string patch

`abbreviateCalibre` decided the **printed sticker abbreviation** by matching the display label:

```ts
if (label === 'Konditirskiy') return 'KN'
```

So a purely cosmetic relabel in Sozlamalar would silently have changed what gets printed on
physical pallet stickers — every new KN label would read "Konditerka" instead of "KN", with
nothing in the app indicating it. Patching the string to accept both values would have left
the same trap armed for the next relabel.

**Fixed at the root: both matchers now key on `calibres.code`, read out of the barcode
itself.** `barcode2` is `PLT-<serial>-<code>-<seq>` (`FinishedReceiptForm.nextBarcode2`, the
sole mint point) and the serial contains a dash, so the code is the **second-to-last**
dash-separated segment — not a fixed index. That is the strongest coupling available: the key
is the value physically printed on the sticker, immutable once minted, and it cannot drift
from what the sticker says. The label survives only as a fallback for codes that are neither
numeric nor `KN` (today `RKN` / "Rezka KN"), so printed output is unchanged for all ten live
calibres.

**Java matcher changed too** (`P1PrinterPlugin.java`), APK exclusion lifted for this one
function since a build is pending anyway.

🚩 **The TS and Java abbreviators are hand-synced with nothing enforcing it, and this is the
second time that pairing has required simultaneous edits** — the first was the CODE_128 → QR
switch, where `stripBarcode2Prefix`/`drawAndCommit` had to move together. Both copies carry a
"keep in sync" comment and that is the entire mechanism. A third divergence is a matter of
time; the durable fix would be to pass the already-abbreviated string across the bridge so
Java never re-derives it, which was out of scope here.

### Verification

`src/lib/barcodeLabel.test.ts` (new, 5 cases) pins the behaviour that touches physical
inventory: `PLT-050826-001-KN-3` abbreviates to `KN` when the label is `Konditirskiy`,
`Konditerka`, `Кондитерка` or empty; numeric codes give K1/K4/K8; `RKN` still falls back to
"Rezka KN"; a malformed barcode still resolves via the label.

Against live data after the rename: **166 of 166 pallets' barcode segment still matches their
calibre's `code`, 22 still carry the literal `-KN-`, and zero barcode2 values contain any
label text.** No sticker value moved.
