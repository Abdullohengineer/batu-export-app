import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useKirimTrips, type KirimTrip } from '../../lib/useKirimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { Stat } from '../../components/ui/Stat'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
}

export function QorovulKirimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves type names on historical trip lines.
  const { productTypes } = useProductTypes(true)
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
      stage1_created_by: profile?.id,
      stage1_completed_at: new Date().toISOString(),
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
        stage2_created_by: profile?.id,
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
      <div className="grid grid-cols-3 gap-3">
        <Stat value={notStarted.length} label="Kutilmoqda" />
        <Stat value={inProgress.length} label="Kirdi·bo'shatilmoqda" tone={inProgress.length > 0 ? 'problem' : 'neutral'} />
        <Stat value={completed.length} label="Yakunlandi" />
      </div>

      <div>
        <SectionHeading>Faol</SectionHeading>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            const isRed = Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeOrderId === trip.order.order_id

            return (
              <Card key={trip.order.order_id} tone={isRed ? 'problem' : 'neutral'}>
                <div className="flex items-center justify-between text-base">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {trip.order.plate} · {trip.order.driver}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {trip.lines.map((l) => `${typeName(l.type_id)} (${l.serial})`).join(', ')}
                    </div>
                  </div>
                  {!isActive && (
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        setActiveOrderId(trip.order.order_id)
                        setActiveStage(isRed ? 2 : 1)
                      }}
                    >
                      {isRed ? 'Yakunlash' : 'Qabul qilish'}
                    </Button>
                  )}
                </div>

                {isActive && activeStage && (
                  <GateStageForm
                    stage={activeStage}
                    onCancel={closeForm}
                    onSubmit={(values) => (activeStage === 1 ? handleStage1(trip, values) : handleStage2(trip, values))}
                  />
                )}
              </Card>
            )
          })}
        </div>
      </div>

      <div>
        <SectionHeading>Yakunlangan</SectionHeading>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Hali yakunlangan reys yo'q.</p>}
          {completed.map((trip) => (
            <Card key={trip.order.order_id} padding="compact">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-900 dark:text-slate-100">
                  {trip.order.plate} · {trip.order.driver}
                </span>
                <div className="text-right">
                  <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {trip.weighing?.net_kg?.toLocaleString() ?? '—'} kg
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {trip.weighing?.completed_at ? new Date(trip.weighing.completed_at).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
