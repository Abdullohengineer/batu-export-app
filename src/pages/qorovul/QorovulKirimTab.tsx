import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useKirimTrips, type KirimTrip } from '../../lib/useKirimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { Stat } from '../../components/ui/Stat'
import { SerialChip } from '../../components/ui/SerialChip'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
}

// mockup "BATU-Qorovul-Screens-v1_1.pdf" p1: DD.MM · HH:MM, not the browser
// locale default.
function formatTripTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} · ${hh}:${min}`
}

export function QorovulKirimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves type/owner names on historical
  // trip lines, and a deactivated client must still resolve to its real
  // name rather than falling back to a raw uuid.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { trips, loading, refresh } = useKirimTrips()
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<1 | 2 | null>(null)

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }

  function ownerName(ownerId: string) {
    return owners.find((o) => o.id === ownerId)?.name ?? ownerId
  }

  function typeSummary(trip: KirimTrip) {
    return [...new Set(trip.lines.map((l) => typeName(l.type_id)))].join(' + ')
  }

  // order_id is the row's own uuid PK, not a human-readable serial -- a
  // multi-line trip's real serials live per-line (§2.1). Same "first line's
  // serial represents the trip" precedent already used by Menejer's own
  // KirimOrdersList.tsx.
  function primarySerial(trip: KirimTrip) {
    return trip.lines[0]?.serial ?? trip.order.order_id
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
        <Stat value={inProgress.length} label="Bo'shatilmoqda" tone={inProgress.length > 0 ? 'problem' : 'neutral'} />
        <Stat value={completed.length} label="Yakunlandi" tone="ok" />
      </div>

      <div>
        <SectionHeading>1 · Faol yuklar</SectionHeading>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            const isRed = Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeOrderId === trip.order.order_id
            // Plate/driver stay in the meta line in BOTH states -- not just
            // the mockup's own "who is this truck" cue, but also how e2e
            // finds this exact row once it's red (hasText: <plate>); the
            // red-state text must not drop it in favour of the saved-weight
            // phrase alone.
            const meta = isRed
              ? `Yuk bilan ${trip.weighing!.gruzheny_kg?.toLocaleString() ?? '—'} kg · bo'sh vazn kutilmoqda · ${trip.order.driver} · ${trip.order.plate}`
              : `${trip.order.declared_total != null ? `So'ralgan ${trip.order.declared_total.toLocaleString()} kg · ` : ''}${trip.order.driver} · ${trip.order.plate}`

            return (
              <Card key={trip.order.order_id} tone={isRed ? 'problem' : 'neutral'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SerialChip>{primarySerial(trip)}</SerialChip>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(trip.order.owner_id)} · {typeSummary(trip)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{meta}</div>
                  </div>
                  {!isActive && (
                    <Button
                      variant={isRed ? 'danger' : 'primary'}
                      size="lg"
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
                    tripInfo={
                      activeStage === 1
                        ? [
                            { label: 'Seriya', value: primarySerial(trip) },
                            { label: 'Buyurtmachi', value: ownerName(trip.order.owner_id) },
                            { label: 'Tur', value: typeSummary(trip) },
                            {
                              label: "So'ralgan",
                              value: trip.order.declared_total != null ? `${trip.order.declared_total.toLocaleString()} kg` : '—',
                            },
                            { label: 'Moshina · haydovchi', value: `${trip.order.plate} · ${trip.order.driver}` },
                          ]
                        : undefined
                    }
                    savedWeightKg={activeStage === 2 ? (trip.weighing?.gruzheny_kg ?? undefined) : undefined}
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
        <SectionHeading>2 · Yakunlangan</SectionHeading>
        <div className="mt-2 space-y-2">
          {completed.length === 0 && <p className="text-sm text-slate-400">Hali yakunlangan reys yo'q.</p>}
          {completed.map((trip) => (
            <Card key={trip.order.order_id} padding="compact">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <SerialChip>{primarySerial(trip)}</SerialChip>
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {ownerName(trip.order.owner_id)} · {typeSummary(trip)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {trip.order.driver} · {trip.order.plate}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {trip.weighing?.net_kg?.toLocaleString() ?? '—'} kg
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {trip.weighing?.completed_at ? formatTripTime(trip.weighing.completed_at) : ''}
                    </div>
                  </div>
                  <span className="text-lg text-emerald-600 dark:text-emerald-400">✓</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
