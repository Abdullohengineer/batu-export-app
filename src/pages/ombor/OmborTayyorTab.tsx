import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useCalibres } from '../../lib/useCalibres'
import { useMoykaOutput, type OutputSerial } from '../../lib/useMoykaOutput'
import { FinishedReceiptForm, type ReceiptValues } from './FinishedReceiptForm'
import { Barcode2Display } from './Barcode2Display'

// §5.3 Tayyor Mahsulot: serials in Moyka awaiting output. Daily receipt form
// (one pallet per save → Barcode #2), per-serial totals (Yuborilgan / Qabul
// qilingan / Jarayonda — neutral until Tugallash), and Tugallash (double-
// confirm → locks final yield-loss into wash_cycles, files to history).
export function OmborTayyorTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { calibres } = useCalibres()
  const { serials, loading, refresh } = useMoykaOutput()
  const [activeForm, setActiveForm] = useState<string | null>(null)
  const [lastBarcode, setLastBarcode] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)

  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  // §5.3: one pallet per save → one finished_pallets row + its Barcode #2.
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
    setLastBarcode((m) => ({ ...m, [serial.serial]: values.barcode2 }))
    refresh()
  }

  // §5.3 Tugallash: locks final yield-loss into wash_cycles (status='final').
  // Derived: (sent − received) / sent × 100. Idempotent upsert on (serial,
  // cycle_no). Double-confirmed in the UI before this runs.
  async function handleTugallash(serial: OutputSerial) {
    const lossPct = serial.sent > 0 ? Math.round(((serial.sent - serial.received) / serial.sent) * 1000) / 10 : 0
    const { error } = await supabase
      .from('wash_cycles')
      .upsert(
        { serial: serial.serial, cycle_no: 1, status: 'final', final_loss_pct: lossPct },
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
        const lossPct = s.sent > 0 ? ((s.sent - s.received) / s.sent) * 100 : 0
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
                  + Qabul qilish
                </button>
              )}
            </div>

            <div className="mt-1 text-slate-500 dark:text-slate-400">
              Yuborilgan: {s.sent.toLocaleString()} kg · Qabul qilingan: {s.received.toLocaleString()} kg · Jarayonda:{' '}
              <span className="font-medium text-slate-900 dark:text-slate-100">{s.inProcess.toLocaleString()} kg</span>
            </div>

            {/* pallets received so far, each with its Barcode #2 */}
            {s.pallets.length > 0 && (
              <ul className="mt-2 space-y-1">
                {s.pallets.map((p) => (
                  <li key={p.barcode2} className="flex items-center justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400">
                      <span className="font-mono">{p.barcode2}</span> · {calibreLabel(p.calibre_id)} ·{' '}
                      {p.weight_kg.toLocaleString()} kg
                    </span>
                    <Barcode2Display
                      data={{
                        barcode2: p.barcode2,
                        serial: s.serial,
                        type: typeName(s.type_id),
                        calibre: calibreLabel(p.calibre_id),
                        weightKg: p.weight_kg,
                        owner: ownerName(s.owner_id),
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            {activeForm === s.serial && (
              <>
                <FinishedReceiptForm
                  serial={s}
                  typeName={typeName(s.type_id)}
                  calibres={calibres}
                  onCancel={() => setActiveForm(null)}
                  onSubmit={(values) => handleReceipt(s, values)}
                />
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
              </>
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
    </div>
  )
}
