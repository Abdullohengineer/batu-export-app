import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatDate'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
import { useMoykaOutput, type OutputSerial } from '../../lib/useMoykaOutput'
import { hasRawRemainder } from '../../lib/stageMembership'
import { MoykaSendForm } from './MoykaSendForm'
import { OldStockToMoykaForm } from './OldStockToMoykaForm'
import { EntityNotes } from '../../components/EntityNotes'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { SerialChip } from '../../components/ui/SerialChip'
import { Stat } from '../../components/ui/Stat'

// §5.2 Moykaga Chiqarish. Two windows — section mirroring (SPEC.md §5 intro;
// DECISIONS.md "Section mirroring / derived stage membership"), NOT two
// independent conditions:
// - Window 1 "Yuborish uchun" = §5.1 KIRIM's Window 2 (raw remainder > 0,
//   hasRawRemainder) — the send form lives here. Sorted newest-first by
//   order_date (DECISIONS "Universal sort rule"), inherited from
//   useMoykaSerials rather than sorted again here.
// - Window 2 = §5.3 Tayyor's Window 1: reuses useMoykaOutput's `serials`
//   directly — sent at all, not yet manually finished (isAwaitingTugallash;
//   updated 2026-07-16, see DECISIONS.md "Manual-only finishing"). No
//   quantity comparison at all: an over-received serial stays visible here
//   exactly as long as an under-received one does, until Tugallash. Also
//   ignores wash_cycles.status independently of quantity, so a serial with
//   more sent after an earlier Tugallash can be in this window AND in
//   §5.3's Tugallangan at the same time; both facts are real. Sorted
//   newest-first by last activity, inherited from useMoykaOutput.
// A partial-send serial can legitimately appear in BOTH this tab's windows
// at once (raw remainder AND not yet finished) — expected, not a bug. The
// spec's "⋯ per-send history" is a per-serial expand within Window 1 only
// (send log + Qaydlar); Window 2 is a read-only mirror of Tayyor's active
// list, so it has no send action or expand of its own.
export function OmborMoykaTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on in-flight/historical serials.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { serials, loading, refresh } = useMoykaSerials()
  const { serials: processing, loading: processingLoading, refresh: refreshProcessing } = useMoykaOutput()
  const [activeSerial, setActiveSerial] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Opening stock, Stage 3 — the old-washed re-wash entry point. Lives in
  // Window 1 because it is a "send to Moyka" action, but it is NOT a row
  // action: it operates on finished pallets, which have no row in this
  // window (that list is raw serials with a remainder). Hence a
  // window-level button rather than a per-serial one.
  const [oldStockOpen, setOldStockOpen] = useState(false)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }

  // §5.2: no new barcode on a send — Barcode #1 (Step 3) already identifies
  // the serial and travels with it. This just records the event.
  //
  // Laborator v2 (2026-07-28): this is also the moment a serial's
  // wash_cycles row is minted — CHIQIM lab testing is now enterable as soon
  // as material is sent to Moyka (not at Tugallash, which no longer exists
  // per-cycle), so the row lab_results.wash_cycle_id needs to point at must
  // already exist by the time Laborator opens the test form. `on conflict
  // do nothing` makes this safe to run on every send, not just the first —
  // a later send to an already-active or already-final serial must never
  // reset its status.
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
    setActiveSerial(null)
    refresh()
  }

  if (loading || processingLoading) return null

  const toSend = serials.filter((s) => hasRawRemainder(s.inputKg, s.sent))

  function serialDetail(s: MoykaSerial) {
    return (
      <div className="mt-2 space-y-3 border-t border-slate-200 pt-2 dark:border-slate-700">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Yuborishlar tarixi</div>
          {s.sends.length === 0 ? (
            <p className="text-sm text-slate-400">Hali yuborilmagan.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {s.sends.map((send) => (
                <li key={send.id} className="text-sm text-slate-600 dark:text-slate-400">
                  {formatDate(send.sent_date)} · {send.qty_kg.toLocaleString()} kg
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Qaydlar</div>
          <div className="mt-1">
            <EntityNotes entityType="moyka" entityId={s.serial} />
          </div>
        </div>
      </div>
    )
  }

  function row(s: MoykaSerial) {
    const isActive = activeSerial === s.serial
    return (
      <Card key={s.serial}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <SerialChip variant="prominent">{s.serial}</SerialChip>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                {ownerName(s.owner_id)} · {typeName(s.type_id)}
              </span>
            </div>
          </div>
          <IconButton label="Batafsil" onClick={() => setExpanded(expanded === s.serial ? null : s.serial)}>
            ⋯
          </IconButton>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat value={s.provisional ? 'kutilmoqda' : s.inputKg.toLocaleString()} label="Jami xom" valueSize="compact" />
          <Stat value={s.sent.toLocaleString()} label="Yuborilgan" tone="ok" valueSize="compact" />
          <Stat value={s.available.toLocaleString()} label="Qoldiq" tone="pending" valueSize="compact" />
        </div>

        {/* §2.15.2 edge case: this material was already sent while the weight
            was still provisional, and the gate net later landed materially
            different — flag, don't block (never re-blocks the send that
            already happened). */}
        {s.provisionalVarianceFlag && (
          <div className="mt-2">
            <StatusNote tone="problem">
              Diqqat: tarozi kutilayotganda yuborilgan, keyin darvoza netasi sezilarli farq qildi.
            </StatusNote>
          </div>
        )}

        {!isActive && (
          <div className="mt-3">
            <Button variant="primary" size="lg" fullWidth onClick={() => setActiveSerial(s.serial)}>
              + Moykaga yuborish
            </Button>
          </div>
        )}

        {isActive && (
          <MoykaSendForm
            serial={s}
            typeName={typeName(s.type_id)}
            ownerName={ownerName(s.owner_id)}
            onCancel={() => setActiveSerial(null)}
            onSubmit={(q) => handleSend(s, q)}
          />
        )}
        {expanded === s.serial && serialDetail(s)}
      </Card>
    )
  }

  // Window 2 — read-only mirror of §5.3 Tayyor's Window 1 (same hook, same
  // set). No send action, no expand: managing what's happening in Moyka is
  // Tayyor Mahsulot's job (§5.3); this is just visibility that it's there.
  function processingRow(s: OutputSerial) {
    return (
      <Card key={s.serial} padding="compact">
        <div className="flex items-center gap-2">
          <SerialChip>{s.serial}</SerialChip>
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

        {/* 🔒 The old-stock entry point lives INSIDE this same container,
            not in a wrapper div of its own between the heading and the
            list. full-chain.spec.ts locates this window's rows via
            `heading -> following-sibling::div[1]`, so an extra sibling div
            here silently displaces the serial list to div[2] and the spec
            stops finding any row (caught by the suite, not by tsc). Keeping
            one container also keeps `space-y-2`'s rhythm consistent between
            the button and the rows. */}
        <div className="mt-2 space-y-2">
          {/* Opening stock, Stage 3 — re-washing old washed pallets. The
              minted serial does NOT come back into this window (it has no
              storage_intake row and is sent in the same transaction, so it
              has no raw remainder); it appears directly in Window 2 below. */}
          {oldStockOpen ? (
            <OldStockToMoykaForm
              onCancel={() => setOldStockOpen(false)}
              onSaved={() => {
                setOldStockOpen(false)
                refresh()
                refreshProcessing()
              }}
            />
          ) : (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onClick={() => setOldStockOpen(true)}
              className="border border-dashed !border-amber-400 !text-amber-800 hover:bg-amber-50 dark:!border-amber-700 dark:!text-amber-400 dark:hover:bg-amber-950/30"
            >
              + Eski zaxirani qayta yuvishga yuborish
            </Button>
          )}

          {toSend.length === 0 && <p className="text-sm text-slate-400">Yuboriladigan serial yo'q.</p>}
          {toSend.map((s) => row(s))}
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
