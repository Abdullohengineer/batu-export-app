import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial, type FinishedPallet } from '../../lib/useMoykaOutput'
import { computeFinalLossPct, isCycleComplete, completionBadge } from '../../lib/tayyorCompletion'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Barcode2Display } from './Barcode2Display'

// §5.3 Tayyor Mahsulot: serials in Moyka awaiting output. Daily receipt form
// (one pallet per save → Barcode #2, form closes on every submit — no
// auto-reopen), per-serial totals (Yuborilgan / Qabul qilingan / Jarayonda,
// floored at 0, with non-blocking Ortiqcha on overage). No fixed tolerance:
// once Qabul qilingan reaches/exceeds Yuborilgan, that submit auto-finalizes
// the cycle into wash_cycles and the serial files to history. Manual
// Tugallash (double-confirm) remains for closing a real shortfall out early.
// Window 2 (Tugallangan, added — see DECISIONS "Tugallangan window"): finalized
// cycle-1 serials (auto or manual), ⋯ expand reusing the same pallet-list
// pattern as Window 1, with a loss/gain badge (Ortiqcha wins over a negative
// loss reading, same as Window 1's non-blocking overage treatment).
export function OmborTayyorTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { calibres } = useCalibres()
  const { serials, completed, loading, refresh } = useMoykaOutput()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [lastBarcode, setLastBarcode] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [expandedCompleted, setExpandedCompleted] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // Shared with both windows — one pallet per row, its Barcode #2 reprintable.
  function palletList(serial: string, typeId: string, ownerId: string, pallets: FinishedPallet[]) {
    if (pallets.length === 0) return null
    return (
      <ul className="mt-2 space-y-1">
        {pallets.map((p) => (
          <li key={p.barcode2} className="flex items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-mono">{p.barcode2}</span> · {calibreLabel(p.calibre_id)} ·{' '}
              {p.weight_kg.toLocaleString()} kg
            </span>
            <Barcode2Display
              data={{
                barcode2: p.barcode2,
                serial,
                type: typeName(typeId),
                calibre: calibreLabel(p.calibre_id),
                weightKg: p.weight_kg,
                owner: ownerName(ownerId),
              }}
            />
          </li>
        ))}
      </ul>
    )
  }

  // Window 2 badge — decision logic lives in tayyorCompletion.ts (pure,
  // unit-tested); this just renders whichever kind it picks.
  function lossBadge(lossPct: number, excess: number) {
    const badge = completionBadge(lossPct, excess)
    if (badge.kind === 'ortiqcha') {
      return (
        <span className="font-medium text-amber-600 dark:text-amber-400">Ortiqcha: +{badge.excessKg.toLocaleString()} kg</span>
      )
    }
    return (
      <span className={badge.pct > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-slate-500 dark:text-slate-400'}>
        {badge.pct > 0 ? '-' : ''}
        {badge.pct.toFixed(1)}%
      </span>
    )
  }

  // §5.3: one pallet per save → one finished_pallets row + its Barcode #2.
  // The form always closes on submit (no auto-reopen — see DECISIONS "Tayyor
  // Mahsulot completion"); a new entry needs an explicit button click.
  // No fixed tolerance: the moment cumulative received reaches or exceeds
  // sent, this same submit auto-finalizes the cycle (no manual confirm) —
  // reusing the Tugallash upsert so it stays idempotent either way.
  async function handleReceipt(serial: OutputSerial, values: ReceiptValues) {
    const { error } = await supabase.from('finished_pallets').insert({
      barcode2: values.barcode2,
      serial: serial.serial,
      type_id: serial.type_id,
      calibre_id: values.calibreId,
      weight_kg: values.weightKg,
      received_date: new Date().toISOString().slice(0, 10),
      created_by: profile?.id,
    })
    if (error) throw error

    const newReceived = serial.received + values.weightKg
    if (isCycleComplete(serial.sent, newReceived)) {
      const { error: finalizeError } = await supabase.from('wash_cycles').upsert(
        {
          serial: serial.serial,
          cycle_no: 1,
          status: 'final',
          final_loss_pct: computeFinalLossPct(serial.sent, newReceived),
        },
        { onConflict: 'serial,cycle_no' },
      )
      if (finalizeError) throw finalizeError
    }

    setLastBarcode((m) => ({ ...m, [serial.serial]: values.barcode2 }))
    setActiveForm(null)
    refresh()
  }

  // §5.3 manual Tugallash: closes a serial out early, before Qabul qilingan
  // reaches Yuborilgan, accepting the shortfall as the final loss. Once
  // received ≥ sent, handleReceipt already auto-finalizes and the serial
  // leaves the active list, so this path is only reachable for a real
  // shortfall. Idempotent upsert on (serial, cycle_no); double-confirmed
  // in the UI before this runs.
  async function handleTugallash(serial: OutputSerial) {
    const { error } = await supabase.from('wash_cycles').upsert(
      {
        serial: serial.serial,
        cycle_no: 1,
        status: 'final',
        final_loss_pct: computeFinalLossPct(serial.sent, serial.received),
      },
      { onConflict: 'serial,cycle_no' },
    )
    if (error) throw error
    setConfirming(null)
    refresh()
  }

  if (loading) return null

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Moykada — chiqishi kutilmoqda</h2>
      {serials.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}

      {serials.map((s) => {
        const lossPct = computeFinalLossPct(s.sent, s.received)
        const lastB = lastBarcode[s.serial]
        return (
          <div key={s.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-slate-900 dark:text-slate-100">{s.serial}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">
                  {typeName(s.type_id)} · {ownerName(s.owner_id)}
                </span>
              </div>
              {activeForm !== s.serial && (
                <button
                  onClick={() => setActiveForm(s.serial)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {s.pallets.length === 0 ? '+ Qabul qilish' : "+ Yana qo'shish"}
                </button>
              )}
            </div>

            <div className="mt-1 text-slate-500 dark:text-slate-400">
              Yuborilgan: {s.sent.toLocaleString()} kg · Qabul qilingan: {s.received.toLocaleString()} kg · Jarayonda:{' '}
              <span className="font-medium text-slate-900 dark:text-slate-100">{s.inProcess.toLocaleString()} kg</span>
              {s.excess > 0 && (
                <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
                  Ortiqcha: +{s.excess.toLocaleString()} kg
                </span>
              )}
            </div>

            {/* pallets received so far, each with its Barcode #2 */}
            {palletList(s.serial, s.type_id, s.owner_id, s.pallets)}

            {/* §5.3 fix: form always closes on submit (no auto-reopen) — a new
                entry needs the "+ Yana qo'shish" click above. The last
                sticker stays visible/printable after close, independent of
                activeForm (see DECISIONS "Tayyor Mahsulot completion"). */}
            {activeForm === s.serial && (
              <FinishedReceiptForm
                serial={s}
                typeName={typeName(s.type_id)}
                calibres={calibres}
                onCancel={() => setActiveForm(null)}
                onSubmit={(values) => handleReceipt(s, values)}
              />
            )}
            {lastB && (
              <div className="mt-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">Oxirgi Barcode #2:</div>
                <Barcode2Display
                  defaultOpen
                  data={{
                    barcode2: lastB,
                    serial: s.serial,
                    type: typeName(s.type_id),
                    calibre: calibreLabel(s.pallets.find((p) => p.barcode2 === lastB)?.calibre_id ?? ''),
                    weightKg: s.pallets.find((p) => p.barcode2 === lastB)?.weight_kg ?? 0,
                    owner: ownerName(s.owner_id),
                  }}
                />
              </div>
            )}

            {/* Tugallash with double-confirm */}
            <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
              {confirming === s.serial ? (
                <div className="space-y-2">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    Yakuniy hisobot — {s.pallets.length} ta pallet, jami {s.received.toLocaleString()} kg qabul qilindi.
                    Yo'qotish <span className="font-medium">{lossPct.toFixed(1)}%</span> deb qulflanadi. Davom etilsinmi?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTugallash(s)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                    >
                      Ha, tugallash
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    >
                      Bekor qilish
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(s.serial)}
                  disabled={s.pallets.length === 0}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Tugallash
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Window 2 — Tugallangan: finalized cycle-1 serials (auto or manual
          Tugallash). ⋯ expand reuses the Window 1 pallet-list pattern; badge
          is Ortiqcha (non-blocking overage, wins) or the locked loss %. */}
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Tugallangan</h2>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Tugallangan serial yo'q.</p>}
          {completed.map((c) => (
            <div key={c.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExpandedCompleted(expandedCompleted === c.serial ? null : c.serial)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <span className="font-mono text-slate-900 dark:text-slate-100">{c.serial}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {ownerName(c.owner_id)} · {typeName(c.type_id)}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">⋯</span>
              </button>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                Yuborilgan {c.sent.toLocaleString()} → tayyor {c.received.toLocaleString()} kg ·{' '}
                {lossBadge(c.lossPct, c.excess)}
              </div>
              {expandedCompleted === c.serial && palletList(c.serial, c.type_id, c.owner_id, c.pallets)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
