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
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
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
  async function handleSend(serial: MoykaSerial, qtyKg: number) {
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

  const toSend = serials.filter((s) => hasRawRemainder(s.actual_qty, s.sent))

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
      <div key={s.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-mono text-slate-900 dark:text-slate-100">{s.serial}</span>
            <span className="ml-2 text-slate-500 dark:text-slate-400">
              {typeName(s.type_id)} · {ownerName(s.owner_id)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isActive && (
              <button
                onClick={() => setActiveSerial(s.serial)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Moykaga yuborish
              </button>
            )}
            <button
              onClick={() => setExpanded(expanded === s.serial ? null : s.serial)}
              className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400"
              aria-label="Batafsil"
            >
              ⋯
            </button>
          </div>
        </div>
        <div className="mt-1 text-slate-500 dark:text-slate-400">
          Qabul qilingan: {s.actual_qty.toLocaleString()} kg · Yuborilgan: {s.sent.toLocaleString()} kg · Qoladi:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">{s.available.toLocaleString()} kg</span>
        </div>

        {isActive && <MoykaSendForm serial={s} onCancel={() => setActiveSerial(null)} onSubmit={(q) => handleSend(s, q)} />}
        {expanded === s.serial && serialDetail(s)}
      </div>
    )
  }

  // Window 2 — read-only mirror of §5.3 Tayyor's Window 1 (same hook, same
  // set). No send action, no expand: managing what's happening in Moyka is
  // Tayyor Mahsulot's job (§5.3); this is just visibility that it's there.
  function processingRow(s: OutputSerial) {
    return (
      <div key={s.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
        <div>
          <span className="font-mono text-slate-900 dark:text-slate-100">{s.serial}</span>
          <span className="ml-2 text-slate-500 dark:text-slate-400">
            {typeName(s.type_id)} · {ownerName(s.owner_id)}
          </span>
        </div>
        <div className="mt-1 text-slate-500 dark:text-slate-400">
          Yuborilgan: {s.sent.toLocaleString()} kg · Jarayonda:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">{s.inProcess.toLocaleString()} kg</span>
          {s.excess > 0 && (
            <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
              Ortiqcha: +{s.excess.toLocaleString()} kg
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yuborish uchun</h2>
        <div className="mt-2 space-y-2">
          {toSend.length === 0 && <p className="text-sm text-slate-400">Yuboriladigan serial yo'q.</p>}
          {toSend.map((s) => row(s))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Moykada — jarayonda</h2>
        <div className="mt-2 space-y-2">
          {processing.length === 0 && <p className="text-sm text-slate-400">Moykada jarayondagi serial yo'q.</p>}
          {processing.map((s) => processingRow(s))}
        </div>
      </div>
    </div>
  )
}
