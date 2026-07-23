import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useChiqimTrips, type ChiqimTrip } from '../../lib/useChiqimTrips'
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

// mockup "BATU-Qorovul-Screens-v1_1.pdf" p5: DD.MM · HH:MM, not the browser
// locale default.
function formatTripTime(iso: string) {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} · ${hh}:${min}`
}

// Qorovul's CHIQIM tab (SPEC §4) — mirrors QorovulKirimTab.tsx exactly:
// same three-counter/two-window (Faol/Yakunlangan) shape, same GateStageForm,
// same gate-photos bucket. Two real differences, both confirmed from SPEC's
// table before building, not assumed:
// 1. Stage 1 ("Qabul qilish") records the EMPTY weight (pustoy_kg) — the
//    truck arrives empty to be loaded. Stage 2 ("Yakunlash") records the
//    LOADED weight (gruzheny_kg) — reversed from KIRIM.
// 2. Stage 2 also requires a third photo (Chiqish hujjati — departure doc).
// The Menejer-facing chiqim_requests.status flip to 'olib_ketildi' happens
// entirely via the complete_chiqim_stage2() DB trigger on stage 2's
// completed_at update — this code never writes chiqim_requests.status
// directly (CHIQIM per-role finalization invariant; also RLS would refuse
// it — qorovul has no write policy on chiqim_requests).
export function QorovulChiqimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on historical trip lines.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { trips, loading, refresh } = useChiqimTrips()
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<1 | 2 | null>(null)

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }

  function ownerName(ownerId: string) {
    return owners.find((o) => o.id === ownerId)?.name ?? ownerId
  }

  function typeSummary(trip: ChiqimTrip) {
    return [...new Set(trip.lines.map((l) => typeName(l.type_id)))].join(' + ')
  }

  // No declared/requested total column on chiqim_requests (unlike KIRIM's
  // declared_total) -- derived client-side from the lines already fetched
  // in full by useChiqimTrips, same as the qty_kg total shown when the
  // request was created.
  function requestedSummary(trip: ChiqimTrip) {
    const totalKg = trip.lines.reduce((sum, l) => sum + l.qty_kg, 0)
    return `${totalKg.toLocaleString()} kg · ${trip.lines.length} qator`
  }

  function closeForm() {
    setActiveRequestId(null)
    setActiveStage(null)
  }

  async function handleStage1(trip: ChiqimTrip, values: GateStageValues) {
    const [platePath, scalePath] = await Promise.all([
      uploadGatePhoto(values.platePhoto!),
      uploadGatePhoto(values.scalePhoto),
    ])

    const { error } = await supabase.from('gate_weighings').insert({
      dir: 'chiqim',
      request_id: trip.request.id,
      pustoy_kg: values.weightKg, // empty truck arrives — reversed from KIRIM stage 1
      stage1_plate_photo: platePath,
      stage1_scale_photo: scalePath,
      stage1_created_by: profile?.id,
      stage1_completed_at: new Date().toISOString(),
    })
    if (error) throw error

    closeForm()
    refresh()
  }

  async function handleStage2(trip: ChiqimTrip, values: GateStageValues) {
    const [scalePath, docPath] = await Promise.all([
      uploadGatePhoto(values.scalePhoto),
      uploadGatePhoto(values.departureDocPhoto!),
    ])

    const { error } = await supabase
      .from('gate_weighings')
      .update({
        gruzheny_kg: values.weightKg, // loaded truck leaves — reversed from KIRIM stage 2
        stage2_scale_photo: scalePath,
        departure_doc_photo: docPath,
        stage2_created_by: profile?.id,
        completed_at: new Date().toISOString(),
      })
      .eq('id', trip.weighing!.id)
    if (error) throw error

    closeForm()
    refresh()
  }

  if (loading) return null

  const notStarted = trips.filter((t) => t.request.status === 'kutilmoqda' && !t.weighing)
  const inProgress = trips.filter(
    (t) => t.request.status === 'kutilmoqda' && t.weighing && !t.weighing.completed_at,
  )
  const completed = trips.filter((t) => t.request.status !== 'kutilmoqda')
  const activeWindow = [...notStarted, ...inProgress]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={notStarted.length} label="Kutilmoqda" />
        <Stat value={inProgress.length} label="Yuklanmoqda" tone={inProgress.length > 0 ? 'problem' : 'neutral'} />
        <Stat value={completed.length} label="Yakunlandi" tone="ok" />
      </div>

      <div>
        <SectionHeading>1 · Faol yuklar</SectionHeading>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            const isRed = Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeRequestId === trip.request.id
            // Plate/driver stay in the meta line in BOTH states -- not just
            // the mockup's own "who is this truck" cue, but also how e2e
            // finds this exact row once it's red (hasText: <plate>); the
            // red-state text must not drop it in favour of the saved-weight
            // phrase alone.
            const meta = isRed
              ? `Bo'sh ${trip.weighing!.pustoy_kg?.toLocaleString() ?? '—'} kg · yuklandi · yuk bilan vazn kutilmoqda · ${trip.request.driver} · ${trip.request.plate}`
              : `So'ralgan ${requestedSummary(trip)} · ${trip.request.driver} · ${trip.request.plate}`

            return (
              <Card key={trip.request.id} tone={isRed ? 'problem' : 'neutral'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SerialChip>So'rov</SerialChip>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(trip.request.owner_id)} · {typeSummary(trip)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{meta}</div>
                  </div>
                  {!isActive && (
                    <Button
                      variant={isRed ? 'danger' : 'primary'}
                      size="lg"
                      onClick={() => {
                        setActiveRequestId(trip.request.id)
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
                    dir="chiqim"
                    requireDepartureDoc={activeStage === 2}
                    tripInfo={
                      activeStage === 1
                        ? [
                            { label: 'Buyurtmachi', value: ownerName(trip.request.owner_id) },
                            { label: "So'ralgan", value: requestedSummary(trip) },
                            { label: 'Moshina · haydovchi', value: `${trip.request.plate} · ${trip.request.driver}` },
                          ]
                        : undefined
                    }
                    savedWeightKg={activeStage === 2 ? (trip.weighing?.pustoy_kg ?? undefined) : undefined}
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
            <Card key={trip.request.id} padding="compact">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <SerialChip>So'rov</SerialChip>
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {ownerName(trip.request.owner_id)} · {typeSummary(trip)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {trip.request.driver} · {trip.request.plate}
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
