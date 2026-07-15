import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useSettingsLimits } from '../../lib/useSettingsLimits'
import { useIntakeLines, type IntakeLine, type IntakeRecord } from '../../lib/useIntakeLines'
import { IntakeAcceptForm, type IntakeAcceptValues } from './IntakeAcceptForm'
import { IntakeDetailView } from './IntakeDetailView'
import { Barcode1Display } from './Barcode1Display'

async function uploadPilePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('intake-photos').upload(path, file)
  if (error) throw error
  return path
}

export function OmborIntakeTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { owners } = useOwners()
  const { limits } = useSettingsLimits()
  const { lines, loading, refresh } = useIntakeLines()
  const [activeSerial, setActiveSerial] = useState<string | null>(null)
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null)

  const kamChiqdiPct = limits.kam_chiqdi_pct ?? 5

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }
  function ownerName(ownerId: string) {
    return owners.find((o) => o.id === ownerId)?.name ?? ownerId
  }

  // §5.1: generate-once. barcode1 is the serial itself (§2.2's ID format
  // for #1 is "—" — unlike #2, a serial is already a stable, unique,
  // human-readable identifier, so no separate ID needed). Stored explicitly
  // at accept time, never recomputed on later views.
  async function handleAccept(line: IntakeLine, values: IntakeAcceptValues) {
    const pilePath = await uploadPilePhoto(values.pilePhoto)

    const { error } = await supabase.from('storage_intake').insert({
      serial: line.serial,
      actual_qty: values.actualQty,
      pile_photo: pilePath,
      komment: values.komment || null,
      barcode1: line.serial,
      confirmed_by: profile?.id,
    })
    if (error) throw error

    setActiveSerial(null)
    refresh()
  }

  if (loading) return null

  const pending = lines.filter((l) => !l.intake)
  const received = lines.filter((l): l is IntakeLine & { intake: IntakeRecord } => l.intake !== null)

  const pendingByOrder = new Map<string, IntakeLine[]>()
  for (const line of pending) {
    const group = pendingByOrder.get(line.order_id) ?? []
    group.push(line)
    pendingByOrder.set(line.order_id, group)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Kutilmoqda</h2>
        <div className="mt-2 space-y-3">
          {pendingByOrder.size === 0 && <p className="text-sm text-slate-400">Kutilayotgan reys yo'q.</p>}
          {[...pendingByOrder.entries()].map(([orderId, orderLines]) => (
            <div key={orderId} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {orderLines[0].plate} · {orderLines[0].driver} · {orderLines[0].order_date}
              </div>
              <div className="mt-2 space-y-2">
                {orderLines.map((line) => {
                  const acceptable = line.gruzheny_kg !== null
                  const isActive = activeSerial === line.serial

                  return (
                    <div
                      key={line.serial}
                      className={
                        acceptable
                          ? 'rounded-md border border-slate-300 p-2 text-sm dark:border-slate-600'
                          : 'rounded-md border border-slate-100 bg-slate-50 p-2 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span className={acceptable ? 'text-slate-900 dark:text-slate-100' : ''}>
                          {line.serial} · {typeName(line.type_id)} · {line.declared_qty.toLocaleString()} kg
                        </span>
                        {acceptable ? (
                          !isActive && (
                            <button
                              onClick={() => setActiveSerial(line.serial)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              Qabul qilish
                            </button>
                          )
                        ) : (
                          <span className="text-xs italic">kutilmoqda (darvoza)</span>
                        )}
                      </div>

                      {isActive && (
                        <IntakeAcceptForm
                          line={line}
                          typeName={typeName(line.type_id)}
                          kamChiqdiPct={kamChiqdiPct}
                          onCancel={() => setActiveSerial(null)}
                          onSubmit={(values) => handleAccept(line, values)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Qabul qilingan mahsulotlar</h2>
        <div className="mt-2 space-y-2">
          {received.length === 0 && <p className="text-sm text-slate-400">Hali qabul qilingan yo'q.</p>}
          {received.map((line) => (
            <div key={line.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-900 dark:text-slate-100">
                  {line.serial} · {typeName(line.type_id)} · {line.intake.actual_qty.toLocaleString()} kg ·{' '}
                  {line.intake.status}
                </span>
                <div className="flex items-center gap-2">
                  {line.intake.barcode1 && (
                    <Barcode1Display
                      data={{
                        serial: line.intake.barcode1,
                        type: typeName(line.type_id),
                        owner: ownerName(line.owner_id),
                        weightKg: line.intake.actual_qty,
                        date: line.order_date,
                      }}
                    />
                  )}
                  <button
                    onClick={() => setExpandedSerial(expandedSerial === line.serial ? null : line.serial)}
                    className="rounded-md px-2 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    aria-label="Batafsil"
                  >
                    ⋯
                  </button>
                </div>
              </div>
              {expandedSerial === line.serial && (
                <IntakeDetailView line={line} ownerName={ownerName(line.owner_id)} typeName={typeName(line.type_id)} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
