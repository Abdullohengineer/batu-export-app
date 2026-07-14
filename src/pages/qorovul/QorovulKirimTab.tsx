import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useKirimTrips, type KirimTrip } from '../../lib/useKirimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
}

export function QorovulKirimTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes()
  const { trips, loading, refresh } = useKirimTrips()
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<1 | 2 | null>(null)

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }

  function closeForm() {
    setActiveOrderId(null)
    setActiveStage(null)
  }

  // §4: stage 1 creates the row; stage 2 updates it. next_serial()/net_kg
  // are never touched here — net is a generated column (§2.15), and the
  // parent kirim_orders.status flip happens only via the DB trigger fired
  // by stage 2's completed_at update, never from this code.
  async function handleStage1(trip: KirimTrip, values: GateStageValues) {
    const [platePath, scalePath] = await Promise.all([
      uploadGatePhoto(values.platePhoto!),
      uploadGatePhoto(values.scalePhoto),
    ])

    const { error } = await supabase.from('gate_weighings').insert({
      dir: 'kirim',
      order_id: trip.order.order_id,
      gruzheny_kg: values.weightKg,
      stage1_plate_photo: platePath,
      stage1_scale_photo: scalePath,
      created_by: profile?.id,
    })
    if (error) throw error

    closeForm()
    refresh()
  }

  async function handleStage2(trip: KirimTrip, values: GateStageValues) {
    const scalePath = await uploadGatePhoto(values.scalePhoto)

    const { error } = await supabase
      .from('gate_weighings')
      .update({
        pustoy_kg: values.weightKg,
        stage2_scale_photo: scalePath,
        completed_at: new Date().toISOString(),
      })
      .eq('id', trip.weighing!.id)
    if (error) throw error

    closeForm()
    refresh()
  }

  if (loading) return null

  const notStarted = trips.filter((t) => t.order.status === 'kutilmoqda' && !t.weighing)
  const inProgress = trips.filter(
    (t) => t.order.status === 'kutilmoqda' && t.weighing && !t.weighing.completed_at,
  )
  const completed = trips.filter((t) => t.order.status !== 'kutilmoqda')
  const activeWindow = [...notStarted, ...inProgress]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{notStarted.length}</div>
          <div className="text-slate-500 dark:text-slate-400">Kutilmoqda</div>
        </div>
        <div className="rounded-md border border-red-200 p-3 dark:border-red-900">
          <div className="text-2xl font-semibold text-red-600 dark:text-red-400">{inProgress.length}</div>
          <div className="text-slate-500 dark:text-slate-400">Kirdi·bo'shatilmoqda</div>
        </div>
        <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{completed.length}</div>
          <div className="text-slate-500 dark:text-slate-400">Yakunlandi</div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Faol</h2>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            const isRed = Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeOrderId === trip.order.order_id

            return (
              <div
                key={trip.order.order_id}
                className={`rounded-md border p-3 ${isRed ? 'border-red-300 dark:border-red-900' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {trip.order.plate} · {trip.order.driver}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {trip.lines.map((l) => `${typeName(l.type_id)} (${l.serial})`).join(', ')}
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => {
                        setActiveOrderId(trip.order.order_id)
                        setActiveStage(isRed ? 2 : 1)
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {isRed ? 'Yakunlash' : 'Qabul qilish'}
                    </button>
                  )}
                </div>

                {isActive && activeStage && (
                  <GateStageForm
                    stage={activeStage}
                    onCancel={closeForm}
                    onSubmit={(values) => (activeStage === 1 ? handleStage1(trip, values) : handleStage2(trip, values))}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yakunlangan</h2>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Hali yakunlangan reys yo'q.</p>}
          {completed.map((trip) => (
            <div
              key={trip.order.order_id}
              className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
            >
              <span className="text-slate-900 dark:text-slate-100">
                {trip.order.plate} · {trip.order.driver}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {trip.weighing?.net_kg?.toLocaleString() ?? '—'} kg ·{' '}
                {trip.weighing?.completed_at ? new Date(trip.weighing.completed_at).toLocaleString() : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
