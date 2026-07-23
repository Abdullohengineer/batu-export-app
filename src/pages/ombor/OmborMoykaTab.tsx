import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
import { useMoykaOutput, type OutputSerial } from '../../lib/useMoykaOutput'
import { hasRawRemainder } from '../../lib/stageMembership'
import { MoykaSendForm } from './MoykaSendForm'
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
  const { serials: processing, loading: processingLoading } = useMoykaOutput()
  const [activeSerial, setActiveSerial] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }

  // §5.2: no new barcode on a send — Barcode #1 (Step 3) already identifies
  // the serial and travels with it. This just records the event.
  //
  // §5.5.4/§5.5.5: tagged with the serial's ACTIVE cycle, not the DB
  // default of 1 — a re-wash send belongs to its own cycle, never
  // conflated with cycle 1's already-finalized figures.
  async function handleSend(serial: MoykaSerial, qtyKg: number) {
    const { error } = await supabase.from('moyka_sends').insert({
      serial: serial.serial,
      wash_cycle: serial.activeCycle,
      sent_date: new Date().toISOString().slice(0, 10),
      qty_kg: qtyKg,
      created_by: profile?.id,
    })
    if (error) throw error
    setActiveSerial(null)
    refresh()
  }

  if (loading || processingLoading) return null

  // §5.5.4/§5.5.5: remainder is against THIS cycle's input (cycleInputKg —
  // actual_qty for cycle 1, the previous cycle's voided kg for a re-wash),
  // never the original actual_qty once a serial has moved past cycle 1.
  const toSend = serials.filter((s) => hasRawRemainder(s.cycleInputKg, s.sent))

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
                  {send.sent_date} · {send.qty_kg.toLocaleString()} kg
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
      <Card key={s.serial} tone={s.isRewash ? 'pending' : 'neutral'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <SerialChip>{s.serial}</SerialChip>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                {ownerName(s.owner_id)} · {typeName(s.type_id)}
              </span>
            </div>
            {/* §5.5.4/§5.5.5: this row is a re-wash cycle (2+), not the
                original intake — flagged so Ombor can tell a second-cycle
                send from a first-cycle one at a glance. */}
            {s.isRewash && (
              <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Qayta yuvish · sikl {s.activeCycle}
              </div>
            )}
          </div>
          <IconButton label="Batafsil" onClick={() => setExpanded(expanded === s.serial ? null : s.serial)}>
            ⋯
          </IconButton>
        </div>

        {s.isRewash && (
          <div className="mt-2">
            <StatusNote tone="pending">
              ⟳ Laborator qaytardi — kalibr palletlari bekor qilindi, qayta yuvishga tayyor
            </StatusNote>
          </div>
        )}

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat
            value={!s.isRewash && s.provisional ? 'kutilmoqda' : s.cycleInputKg.toLocaleString()}
            label={s.isRewash ? 'Qaytgan' : 'Jami xom'}
          />
          <Stat value={s.sent.toLocaleString()} label="Yuborilgan" tone="ok" />
          <Stat value={s.available.toLocaleString()} label="Qoldiq" tone="pending" />
        </div>

        {/* §5.1 amend: gate-vs-declared, cycle 1 only, once gate stage 2 is known. */}
        {!s.isRewash && s.truckVariance && Math.abs(s.truckVariance.diffKg) > 0 && (
          <div className="mt-2">
            <StatusNote tone="pending">
              Darvoza neta reys bo'yicha e'lon qilingandan {s.truckVariance.diffKg >= 0 ? '+' : ''}
              {s.truckVariance.diffKg.toLocaleString()} kg ({s.truckVariance.diffPct >= 0 ? '+' : ''}
              {s.truckVariance.diffPct.toFixed(1)}%) farq qiladi.
            </StatusNote>
          </div>
        )}
        {/* §2.15.2 edge case: this cycle's material was already sent while the
            weight was still provisional, and the gate net later landed
            materially different — flag, don't block (never re-blocks the
            send that already happened). */}
        {!s.isRewash && s.provisionalVarianceFlag && (
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
          {s.isRewash && (
            <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">sikl {s.activeCycle}</span>
          )}
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
        <div className="mt-2 space-y-2">
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
