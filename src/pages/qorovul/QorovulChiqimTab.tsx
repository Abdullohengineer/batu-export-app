import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useChiqimTrips, type ChiqimTrip } from '../../lib/useChiqimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'
import { FuraPhotoForm } from './FuraPhotoForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { Stat } from '../../components/ui/Stat'
import { SerialChip } from '../../components/ui/SerialChip'
import { FuraBadge } from '../../components/ui/FuraBadge'
import { GatePhoto } from '../../components/GatePhoto'
import { formatDate } from '../../lib/formatDate'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
}

// Fura photos live in their own bucket, and — unlike every other photo in
// this app, which is a flat `<uuid>.jpg` — the path is prefixed with the
// request id, so a trip's two captures sit together in the storage browser.
// See DECISIONS.md "Fura CHIQIM gate photos".
const FURA_BUCKET = 'chiqim-fura-photos'

async function uploadFuraPhoto(requestId: string, kind: 'kirdi' | 'chiqdi', file: File) {
  const path = `${requestId}/${kind}-${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(FURA_BUCKET).upload(path, file)
  if (error) throw error
  return path
}

// mockup "BATU-Qorovul-Screens-v1_1.pdf" p5: date · HH:MM, not the browser
// locale default -- date portion now DD-MM-YY via the shared helper.
function formatTripTime(iso: string) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(d)} · ${hh}:${min}`
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
  const [activeStage, setActiveStage] = useState<1 | 2 | 'kirdi' | 'chiqdi' | null>(null)

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
    // A raw line's qty_kg is optional (2026-08-01 pool rework, see
    // DECISIONS.md "Raw dispatch serial pool") — contributes 0 here, same
    // treatment as OmborChiqimTab.tsx's own requestTarget.
    const totalKg = trip.lines.reduce((sum, l) => sum + (l.qty_kg ?? 0), 0)
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

  // Fura capture. Writes ONE append-only row; nothing else moves. It does
  // not touch chiqim_requests, does not create a gate_weighings row, and
  // does not affect chiqim_departed_at — a fura's departure is still Ombor's
  // finish click alone (0104). Qorovul's record and Ombor's flow are
  // physically parallel and neither gates the other.
  async function handleFuraPhoto(trip: ChiqimTrip, kind: 'kirdi' | 'chiqdi', photo: File) {
    const path = await uploadFuraPhoto(trip.request.id, kind, photo)
    const { error } = await supabase.from('chiqim_fura_photos').insert({
      request_id: trip.request.id,
      kind,
      photo_url: path,
      uploaded_by: profile?.id,
    })
    if (error) throw error
    closeForm()
    refresh()
  }

  if (loading) return null

  // Fura (2026-08-30, see DECISIONS.md "CHIQIM truck type: Fura"): a fura
  // is too big for the gate scale and is never weighed, so it must never
  // reach Window 1. It is deliberately EXCLUDED rather than shown as an
  // un-actionable courtesy row — a card in a work queue that the guard can
  // see but can never clear would sit there forever, which is worse than
  // not listing it. It still appears, read-only, in Window 2 the moment
  // Ombor finishes loading: that window's own membership test is
  // `status !== 'kutilmoqda'`, and the completion trigger (migration 0104)
  // flips a fura's status at exactly that point, so the courtesy record
  // costs no extra condition here.
  const isGateWeighed = (t: ChiqimTrip) => t.request.truck_type !== 'fura'

  // Fura is BACK in Window 1 (2026-08-30, photo-only — 0104 had excluded it
  // outright). Its two stages mirror the weighed flow's shape exactly:
  // Kirdi at entry, Chiqdi at exit, each closed by its own photo.
  //
  // 🔒 Fura membership is driven by the PHOTOS, never by `status`. Using
  // status here would be a real bug, not a style choice: Ombor's finish
  // click flips a fura to 'olib_ketildi' (0104's completion trigger), so a
  // status-based window would yank the row out of Qorovul's queue the
  // moment Ombor finished loading — taking the Chiqdi affordance with it,
  // before the guard had ever photographed the nakladnoy. The two flows are
  // physically parallel, so Qorovul's queue tracks Qorovul's own evidence.
  const furaAwaitingKirdi = trips.filter((t) => !isGateWeighed(t) && !t.kirdiPhoto)
  const furaAwaitingChiqdi = trips.filter((t) => !isGateWeighed(t) && t.kirdiPhoto && !t.chiqdiPhoto)

  const notStarted = trips.filter((t) => isGateWeighed(t) && t.request.status === 'kutilmoqda' && !t.weighing)
  const inProgress = trips.filter(
    (t) => isGateWeighed(t) && t.request.status === 'kutilmoqda' && t.weighing && !t.weighing.completed_at,
  )
  // A fura leaves the active view once BOTH captures exist — again photo-
  // driven, not status-driven, for the same reason.
  const completed = trips.filter((t) =>
    isGateWeighed(t) ? t.request.status !== 'kutilmoqda' : Boolean(t.kirdiPhoto && t.chiqdiPhoto),
  )
  const activeWindow = [...notStarted, ...furaAwaitingKirdi, ...inProgress, ...furaAwaitingChiqdi]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={notStarted.length + furaAwaitingKirdi.length} label="Kutilmoqda" />
        <Stat
          value={inProgress.length + furaAwaitingChiqdi.length}
          label="Yuklanmoqda"
          tone={inProgress.length + furaAwaitingChiqdi.length > 0 ? 'problem' : 'neutral'}
        />
        <Stat value={completed.length} label="Yakunlandi" tone="ok" />
      </div>

      <div>
        <SectionHeading>1 · Faol yuklar</SectionHeading>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            // A fura's "red"/second-stage state is having its entry photo
            // but not its exit one — the same two-stage shape the weighed
            // flow has, with photos in place of weights.
            const isFura = !isGateWeighed(trip)
            const isRed = isFura
              ? Boolean(trip.kirdiPhoto && !trip.chiqdiPhoto)
              : Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeRequestId === trip.request.id
            const furaStage: 'kirdi' | 'chiqdi' = trip.kirdiPhoto ? 'chiqdi' : 'kirdi'
            // Plate/driver stay in the meta line in BOTH states -- not just
            // the mockup's own "who is this truck" cue, but also how e2e
            // finds this exact row once it's red (hasText: <plate>); the
            // red-state text must not drop it in favour of the saved-weight
            // phrase alone.
            const meta = isFura
              ? isRed
                ? `Kirdi qayd etilgan · nakladnoy rasmi kutilmoqda · ${trip.request.driver} · ${trip.request.plate}`
                : `O'lchovsiz · moshina rasmi kutilmoqda · ${trip.request.driver} · ${trip.request.plate}`
              : isRed
                ? `Bo'sh ${trip.weighing!.pustoy_kg?.toLocaleString() ?? '—'} kg · yuklandi · yuk bilan vazn kutilmoqda · ${trip.request.driver} · ${trip.request.plate}`
                : `So'ralgan ${requestedSummary(trip)} · ${trip.request.driver} · ${trip.request.plate}`

            return (
              <Card key={trip.request.id} tone={isRed ? 'problem' : 'neutral'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>So'rov</SerialChip>
                      <FuraBadge truckType={trip.request.truck_type} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(trip.request.owner_id)} · {typeSummary(trip)}
                      </span>
                    </div>
                    <div className="truncate text-sm text-slate-500 dark:text-slate-400">{meta}</div>
                  </div>
                  {!isActive && (
                    <Button
                      variant={isRed ? 'danger' : 'primary'}
                      size="lg"
                      onClick={() => {
                        setActiveRequestId(trip.request.id)
                        setActiveStage(isFura ? furaStage : isRed ? 2 : 1)
                      }}
                    >
                      {isFura ? (isRed ? 'Chiqdi' : 'Kirdi') : isRed ? 'Yakunlash' : 'Qabul qilish'}
                    </Button>
                  )}
                </div>

                {isActive && activeStage && isFura && (activeStage === 'kirdi' || activeStage === 'chiqdi') && (
                  <FuraPhotoForm
                    stage={activeStage}
                    tripInfo={[
                      { label: 'Buyurtmachi', value: ownerName(trip.request.owner_id) },
                      { label: "So'ralgan", value: requestedSummary(trip) },
                      { label: 'Moshina · haydovchi', value: `${trip.request.plate} · ${trip.request.driver}` },
                    ]}
                    onCancel={closeForm}
                    onSubmit={(photo) => handleFuraPhoto(trip, activeStage, photo)}
                  />
                )}

                {isActive && activeStage && !isFura && (activeStage === 1 || activeStage === 2) && (
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
                    <FuraBadge truckType={trip.request.truck_type} />
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {ownerName(trip.request.owner_id)} · {typeSummary(trip)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {trip.request.driver} · {trip.request.plate}
                  </div>
                  {/* A completed fura's whole gate record is these two
                      captures — the weighed flow shows a net kg here, so
                      showing nothing at all would make the row read as
                      incomplete. Thumbnails open in a new tab (GatePhoto's
                      default): this tab has no lightbox of its own, and
                      adding one is out of scope. */}
                  {!isGateWeighed(trip) && (
                    <div className="mt-1 flex items-center gap-2">
                      <GatePhoto path={trip.kirdiPhoto} label="Moshina rasmi (kirdi)" bucket={FURA_BUCKET} thumbnail />
                      <GatePhoto path={trip.chiqdiPhoto} label="Nakladnoy rasmi (chiqdi)" bucket={FURA_BUCKET} thumbnail />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    {/* A fura has no gate net and never will (migration
                        0104's own header: CHIQIM gate net was never a value
                        source anyway). Showing Ombor's loaded total here,
                        explicitly labelled "o'lchovsiz", is the honest
                        record — a bare "—" would read as a weighing someone
                        forgot to do. */}
                    <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {isGateWeighed(trip)
                        ? `${trip.weighing?.net_kg?.toLocaleString() ?? '—'} kg`
                        : `${trip.loadedKg?.toLocaleString() ?? '—'} kg`}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isGateWeighed(trip)
                        ? trip.weighing?.completed_at
                          ? formatTripTime(trip.weighing.completed_at)
                          : ''
                        : "o'lchovsiz · yuklangan"}
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
