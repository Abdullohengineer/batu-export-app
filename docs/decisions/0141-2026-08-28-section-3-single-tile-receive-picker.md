## 2026-08-28 — Section 3 single-tile receive picker

**Prompt:** redesign §5.3 (Moykadan qabul qilish) from the per-serial card layout to a single
dashed tile, "+ Moykadan qabul qilish." Tapping opens a picker — every serial with a positive live
in-Moyka balance and a passing lab verdict, as chips (`SERIAL ~KG kg`) — select one, the existing
kalibr+weight+save+Barcode#2 form opens for it. UI-only, no schema/read-path/balance change; reuse
`useMoykaOutput`'s already-live figure. Hard gate in the brief: render-tree diff + confirmation the
existing receipt form embeds as-is, shown before any code touched — same shape as the last two
prompts.

**Investigation, before writing any code — nothing needed correcting this time** (unlike the prior
two prompts): `useMoykaOutput()`'s `OutputSerial.inProcess` is already `jarayonda(sent, received) =
max(0, sent − received)` — the live in-Moyka balance the brief asked for, already floored, no new
read. `FinishedReceiptForm.tsx` already matches "image 5" exactly — serial header, owner·type
readonly, **"Shu paytgacha qabul" running total already present**, sana, Kalibr dropdown, Og'irlik
input, "Saqlash va shtrix-kod chiqarish," "Yopish" — every field the brief describes was already
there. It already clears its own `calibreId`/`weight` state after a successful save and does
**not** call `onCancel()` itself; the old "closes on every submit" behavior was entirely the
*parent's* doing (`OmborTayyorTab.handleReceipt` called `setActiveForm(null)` after every save).
So "stay in the form after save" (this prompt's explicit reversal of that old behavior) needed
**zero changes to `FinishedReceiptForm.tsx`** — only to the code that was unmounting it.

**One real design problem surfaced during the investigation, solved before writing code:** the
brief requires "still allow further pallets from this serial in the same session" even after a
save drops its live balance to ≤0 (over-receive stays allowed, per 0086) — but on next full
refresh it should drop off the picker. `useMoykaOutput()`'s own `serials` array is *always*
pre-filtered to `isInMoyka` (balance > 0), so naively re-deriving the selected serial from that
prop after every `refresh()` would make the form vanish mid-session the instant a save brought the
balance to exactly 0 — the opposite of what's asked. Resolved by capturing the selected
`OutputSerial` as local component state at chip-click time (not re-derived reactively from the
prop) and patching it locally after each save (`received += weightKg`, append to `pallets`, bump
`barcodeSeqByCalibre`) — correct for the running total, the "Shu seriyaga qabul qilingan" history,
and the next barcode sequence number, all without a new read. Only closing the tile ("Yopish") and
reopening re-derives the picker's own chip list from the live, refreshed `serials` prop.

**One explicit visibility change, applied as instructed, not silently:** the old per-row layout
showed *every* in-Moyka serial as its own card, with a "Tahlil kutilmoqda"/"Rad etildi" note in
place of the receive button when the lab hadn't passed yet. The brief's chip list is scoped to
`labStatus === 'passed'` from the start — an untested/rejected serial doesn't appear in this tile
at all any more, not shown-but-blocked. Matches this prompt's own explicit filter description
("every serial where in_moyka > 0 AND lab verdict passed"); same treatment as the analogous
`wip_rows`/chip-list decisions in the two prior prompts.

**Why no old/new-stock split on the receive side** (the brief's own question, answered): §5.2 needs
two tiles because *how a serial gets sent to Moyka* genuinely forks into two different write paths
— a real raw serial (`moyka_sends` insert against an existing serial) vs. old washed stock (a
whole separate mint-and-consume RPC minting a brand-new serial). §5.3 has no such fork: by the time
a serial is sitting in Moyka waiting on output, it is just a serial — `finished_pallets` gets
written the same way regardless of how that serial came to exist. A minted serial's old-stock
lineage is metadata (`serial.isMinted`, already read internally by `handleReceipt` to write the
lineage note) — never a workflow branch Ombor has to pick between. One tile, one picker, one form.

**Shared chip-picker primitive — not extracted, per the brief's own judgment call.** Compared
`ReceiveFromMoykaForm.tsx`'s chip list against §5.2's `NewStockToMoykaForm.tsx`: different source
types (`OutputSerial` vs `MoykaSerial`), different filters (`labStatus==='passed'` vs
`available>0`), and completely different post-selection content (the existing `FinishedReceiptForm`
component vs. a bespoke weight-entry sub-form). The shared surface is ~10 lines of "button styled
as a chip, serial + ~kg" — not extracted, same reasoning as the prior prompt's identical call.

**Implementation:**
- `src/pages/ombor/ReceiveFromMoykaForm.tsx` (new) — chip list (`serials.filter(s => s.labStatus
  === 'passed')`; membership on `inProcess > 0` already guaranteed by `useMoykaOutput`), single
  selection held as local state, `FinishedReceiptForm` embedded as-is, the local same-session patch
  described above, a "Shu seriyaga qabul qilingan" collapsible history (reusing the old per-row
  layout's own `palletList()` shape — barcode/kalibr/kg/received_date, each reprintable via
  `Barcode2Display`), and the "Oxirgi Barcode #2" auto-open sticker display the old parent used to
  render after each save (needed to keep the on-screen QR/print-trigger behavior identical — this
  wasn't in the brief's own bullet list but is exactly what "prints Barcode #2 as today" requires).
- `src/pages/ombor/OmborTayyorTab.tsx` — per-serial `row()`/`serialDetail()`/`palletList()` and the
  `activeForm`/`lastBarcode`/`expandedPallets` state removed; replaced with a single `tileOpen:
  boolean`. `handleReceipt`'s body (the `finished_pallets` insert + the minted-serial lineage note)
  is byte-for-byte unchanged — only the UI calling it changed, and it now just calls `refresh()`.
  Section heading changed from "Moyka — chiqishi kutilmoqda" to **"Moykadan qabul qilish"** — the
  old wording described a list ("awaiting output"); the new one describes the tile's own action,
  matching §5.2's heading-above-tile pattern. The now-meaningless "1 ·" numbering (there is no
  Window 2 left in this tab) is dropped along with it.
- Three e2e specs drove the old per-row receive flow and needed adapting (not deleted): `tests/e2e/
  lab-packing-hard-gate.spec.ts` (both the "gate absent" proof — now the serial's chip simply isn't
  in the list, a cleaner proof than a missing button on a visible card — and the actual pack step),
  `tests/e2e/full-chain.spec.ts` (receive step + the two now-renamed heading lookups), and `tests/
  e2e/lab-relocation-loss-verification.spec.ts` (pack step) — all three now open the tile, select
  the chip by serial (`getByRole('button', { name: /^SERIAL\b/ })`), and drive the unchanged
  `FinishedReceiptForm` fields directly.

**Verified:** `npx tsc -b --noEmit` clean; `node --test` suite passes; `npx oxlint` clean on every
touched/new file; `npm run build` succeeds. No live-browser Playwright run this session (same
network-policy limitation as the prior two prompts) — the three adapted e2e specs are updated for
correctness but not run.

SPEC.md §5.3 amended inline (struck the old per-row description) — not rewritten wholesale.
