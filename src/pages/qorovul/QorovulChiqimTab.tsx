import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useChiqimTrips, type ChiqimTrip } from '../../lib/useChiqimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
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
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { trips, loading, refresh } = useChiqimTrips()
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<1 | 2 | null>(null)

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }
  function calibreLabel(calibreId: string) {
    return calibres.find((c) => c.id === calibreId)?.label ?? calibreId
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
            const isActive = activeRequestId === trip.request.id

            return (
              <div
                key={trip.request.id}
                className={`rounded-md border p-3 ${isRed ? 'border-red-300 dark:border-red-900' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {trip.request.plate} · {trip.request.driver}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {trip.lines.map((l) => `${typeName(l.type_id)} · ${calibreLabel(l.calibre_id)} — ${l.qty_kg.toLocaleString()} kg`).join(', ')}
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => {
                        setActiveRequestId(trip.request.id)
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
                    dir="chiqim"
                    requireDepartureDoc={activeStage === 2}
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
              key={trip.request.id}
              className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700"
            >
              <span className="text-slate-900 dark:text-slate-100">
                {trip.request.plate} · {trip.request.driver}
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
