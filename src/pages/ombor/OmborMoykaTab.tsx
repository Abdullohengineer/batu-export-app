import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
import { sortByDateDesc } from '../../lib/sortByDate'
import { MoykaSendForm } from './MoykaSendForm'
import { EntityNotes } from '../../components/EntityNotes'

// §5.2 Moykaga Chiqarish. Two windows matching the Steps 2-3 pattern
// (Faol/Yakunlangan-style): "Yuborish uchun" (serials with available balance
// > 0, the send form lives here) and "To'liq yuborilgan" (fully sent, sorted
// newest-first by last send date — DECISIONS "History list ordering"). The
// spec's "⋯ per-send history" is a per-serial expand within either window
// (send log + Qaydlar), not a third window — see PR/DECISIONS.
export function OmborMoykaTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { serials, loading, refresh } = useMoykaSerials()
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

  if (loading) return null

  const toSend = serials.filter((s) => s.available > 0)
  const fullySent = sortByDateDesc(
    serials.filter((s) => s.available <= 0 && s.sent > 0),
    (s) => s.lastSentDate,
  )

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

  function row(s: MoykaSerial, canSend: boolean) {
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
            {canSend && !isActive && (
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yuborish uchun</h2>
        <div className="mt-2 space-y-2">
          {toSend.length === 0 && <p className="text-sm text-slate-400">Yuboriladigan serial yo'q.</p>}
          {toSend.map((s) => row(s, true))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">To'liq yuborilgan</h2>
        <div className="mt-2 space-y-2">
          {fullySent.length === 0 && <p className="text-sm text-slate-400">Hali to'liq yuborilgan serial yo'q.</p>}
          {fullySent.map((s) => row(s, false))}
        </div>
      </div>
    </div>
  )
}
