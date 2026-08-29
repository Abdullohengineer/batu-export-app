import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
import { useMoykaOutput, type OutputSerial } from '../../lib/useMoykaOutput'
import { NewStockToMoykaForm } from './NewStockToMoykaForm'
import { OldStockToMoykaForm } from './OldStockToMoykaForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// §5.2 Moykaga Chiqarish. Two windows — section mirroring (SPEC.md §5 intro;
// DECISIONS.md "Section mirroring / derived stage membership"), NOT two
// independent conditions:
// - Window 1 "Yuborish uchun" — AMENDED 2026-08-28, two-tile picker redesign
//   (see DECISIONS.md same date): the old per-serial-row list is gone,
//   replaced by two dashed tiles (Yangi zaxira / Eski zaxira), only one
//   expanded at a time. The Yangi zaxira tile's chip list is scoped to
//   `available > 0` (NewStockToMoykaForm), not `hasRawRemainder` — this is
//   a deliberate deviation from §5.1's own Window 2 predicate (`available`
//   also nets raw-dispatch/rezka draws, which `hasRawRemainder` ignores),
//   so this window's own membership no longer mirrors §5.1 W2 byte-for-byte
//   the way section mirroring otherwise holds across every other boundary.
//   Row-level detail (send history, Qaydlar, the provisional-variance
//   flag) dropped with the old row — not shown anywhere in this redesign.
// - Window 2 "Moykada" = §5.3 Tayyor's Window 1: reuses useMoykaOutput's
//   `serials` directly — a positive live in-Moyka balance (isInMoyka: sent
//   > received). No manual close event any more (DECISIONS.md "Moyka loss
//   becomes live; remove Tugallash") — a serial drops off both windows on
//   its own once packing catches up to what was sent. Sorted newest-first
//   by last activity, inherited from useMoykaOutput. Unchanged by this
//   redesign — read-only, no send action, no expand of its own.
export function OmborMoykaTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on in-flight/historical serials.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { serials, loading, refresh } = useMoykaSerials()
  const { serials: processing, loading: processingLoading, refresh: refreshProcessing } = useMoykaOutput()
  // Which tile is expanded, if any -- a single value guarantees the two
  // tiles are mutually exclusive (expanding one collapses the other) for
  // free, and `null` (both collapsed) is the default on mount.
  const [expandedTile, setExpandedTile] = useState<'yangi' | 'eski' | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }

  // §5.2: no new barcode on a send — Barcode #1 (Step 3) already identifies
  // the serial and travels with it. This just records the event. Unchanged
  // by the two-tile redesign — only the UI that calls this changed; the
  // insert/upsert bodies are identical to before.
  //
  // Laborator v2 (2026-07-28): this is also the moment a serial's
  // wash_cycles row is minted — CHIQIM lab testing is now enterable as soon
  // as material is sent to Moyka, so the row lab_results.wash_cycle_id needs
  // to point at must already exist by the time Laborator opens the test
  // form. `on conflict do nothing` makes this safe to run on every send, not
  // just the first. wash_cycles is lab-linkage-only now (DECISIONS.md "Moyka
  // loss becomes live; remove Tugallash") — nothing ever writes 'final' to
  // its status again, so this upsert's status value is otherwise inert.
  async function handleSend(serial: MoykaSerial, qtyKg: number) {
    const { error: cycleErr } = await supabase
      .from('wash_cycles')
      .upsert({ serial: serial.serial, status: 'active' }, { onConflict: 'serial', ignoreDuplicates: true })
    if (cycleErr) throw cycleErr

    const { error } = await supabase.from('moyka_sends').insert({
      serial: serial.serial,
      sent_date: new Date().toISOString().slice(0, 10),
      qty_kg: qtyKg,
      created_by: profile?.id,
    })
    if (error) throw error
    refresh()
  }

  if (loading || processingLoading) return null

  // Both tiles share this exact dashed-border treatment (verbatim, not
  // re-derived) so they read as one visual family — see DECISIONS.md
  // "Two-tile Moyka send picker" for why the pattern is reused as-is.
  const tileButtonClass =
    'border border-dashed !border-amber-400 !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400 dark:hover:bg-amber-950/30'

  // Window 2 — read-only mirror of §5.3 Tayyor's Window 1 (same hook, same
  // set). No send action, no expand: managing what's happening in Moyka is
  // Tayyor Mahsulot's job (§5.3); this is just visibility that it's there.
  function processingRow(s: OutputSerial) {
    return (
      <Card key={s.serial} padding="compact">
        <div className="flex items-center gap-2">
          <SerialChip>{s.serial}</SerialChip>
          <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {ownerName(s.owner_id)} · {typeName(s.type_id)}
          </span>
        </div>
        <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
          Yuborilgan {s.sent.toLocaleString()} kg · Jarayonda {s.inProcess.toLocaleString()} kg
          {s.excess > 0 && (
            <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
              Ortiqcha: +{s.excess.toLocaleString()} kg
            </span>
          )}
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading>1 · Yuborishga tayyor</SectionHeading>

        {/* 🔒 Both tile entry points live INSIDE this same container, not in
            a wrapper div of its own between the heading and the rest —
            full-chain.spec.ts locates this window via
            `heading -> following-sibling::div[1]`, so an extra sibling div
            here would silently displace what it looks for (caught by the
            suite, not by tsc). */}
        <div className="mt-2 space-y-2">
          {expandedTile === 'yangi' ? (
            <NewStockToMoykaForm serials={serials} typeName={typeName} onCancel={() => setExpandedTile(null)} onSubmit={(s, qty) => handleSend(s, qty)} />
          ) : (
            <Button variant="ghost" size="md" fullWidth onClick={() => setExpandedTile('yangi')} className={tileButtonClass}>
              + Yangi zaxiradan moykaga yuborish
            </Button>
          )}

          {/* Opening stock, Stage 3 — re-washing old washed pallets. The
              minted serial does NOT come back into this window (it has no
              storage_intake row and is sent in the same transaction, so it
              has no raw remainder); it appears directly in Window 2 below. */}
          {expandedTile === 'eski' ? (
            <OldStockToMoykaForm
              onCancel={() => setExpandedTile(null)}
              onSaved={() => {
                setExpandedTile(null)
                refresh()
                refreshProcessing()
              }}
            />
          ) : (
            <Button variant="ghost" size="md" fullWidth onClick={() => setExpandedTile('eski')} className={tileButtonClass}>
              + Eski zaxirani qayta yuvishga yuborish
            </Button>
          )}
        </div>
      </div>

      <div>
        <SectionHeading>2 · Moykada</SectionHeading>
        <div className="mt-2 space-y-2">
          {processing.length === 0 && <p className="text-sm text-slate-400">Moykada jarayondagi serial yo'q.</p>}
          {processing.map((s) => processingRow(s))}
        </div>
      </div>
    </div>
  )
}
