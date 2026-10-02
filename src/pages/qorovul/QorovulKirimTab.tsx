import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { invalidateReportData } from '../../lib/queryClient'
import { useAuth } from '../../lib/AuthProvider'
import { useProductTypes } from '../../lib/useProductTypes'
import { useOwners } from '../../lib/useOwners'
import { useKirimTrips, type KirimTrip } from '../../lib/useKirimTrips'
import { GateStageForm, type GateStageValues } from './GateStageForm'
import { FuraPhotoForm } from './FuraPhotoForm'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { Stat } from '../../components/ui/Stat'
import { StatusNote } from '../../components/ui/StatusNote'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { RezkaBadge } from '../../components/ui/RezkaBadge'
import { FuraBadge } from '../../components/ui/FuraBadge'
import { GatePhoto } from '../../components/GatePhoto'
import { formatDate } from '../../lib/formatDate'

async function uploadGatePhoto(file: File) {
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('gate-photos').upload(path, file)
  if (error) throw error
  return path
}

// SPEC.md "KIRIM fura" -- same shape as QorovulChiqimTab.tsx's own
// FURA_BUCKET/uploadFuraPhoto, pointed at the new KIRIM-scoped table/bucket.
const FURA_BUCKET = 'kirim-fura-photos'

async function uploadKirimFuraPhoto(orderId: string, kind: 'kirdi' | 'chiqdi', file: File) {
  const path = `${orderId}/${kind}-${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(FURA_BUCKET).upload(path, file)
  if (error) throw error
  return path
}

// mockup "BATU-Qorovul-Screens-v1_1.pdf" p1: date · HH:MM, not the browser
// locale default -- date portion now DD-MM-YY via the shared helper.
function formatTripTime(iso: string) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(d)} · ${hh}:${min}`
}

export function QorovulKirimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves type/owner names on historical
  // trip lines, and a deactivated client must still resolve to its real
  // name rather than falling back to a raw uuid.
  const { productTypes } = useProductTypes(true)
  const { owners } = useOwners(true)
  const { trips, loading, refreshing, error: loadError, refresh } = useKirimTrips()
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<1 | 2 | 'kirdi' | 'chiqdi' | null>(null)

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

  function primaryPartiyaNo(trip: KirimTrip) {
    return trip.lines[0]?.partiya_no ?? null
  }

  function primaryTypeName(trip: KirimTrip) {
    return typeName(trip.lines[0]?.type_id ?? '')
  }

  // Rezka Prompt 3: the card is per truck; badge it when any line on the
  // truck is a Rezka line (display only -- the gate's job is unchanged).
  function hasRezka(trip: KirimTrip) {
    return trip.lines.some((l) => l.process === 'rezka')
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
    // 0211: Gate weighing -- gruzheny_kg feeds effective_qty pending net.
    invalidateReportData()
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
    // 0211: Gate weighing -- net_kg (generated from pustoy_kg) is the
    // effective_qty basis report_query_page et al. read.
    invalidateReportData()
  }

  // SPEC.md "KIRIM fura" -- mirrors QorovulChiqimTab.tsx's own
  // handleFuraPhoto exactly: one append-only row, nothing else moves. It
  // does not touch kirim_orders, does not create a gate_weighings row, and
  // does not affect intake acceptability by itself (that's the EXISTENCE of
  // the kirdi row, read by useIntakeLines/useLaboratorKirim, not this
  // handler).
  async function handleFuraPhoto(trip: KirimTrip, kind: 'kirdi' | 'chiqdi', photo: File) {
    const path = await uploadKirimFuraPhoto(trip.order.order_id, kind, photo)
    const { error } = await supabase.from('kirim_fura_photos').insert({
      order_id: trip.order.order_id,
      kind,
      photo_url: path,
      uploaded_by: profile?.id,
    })
    if (error) throw error
    closeForm()
    refresh()
  }

  if (loading) return null

  // SPEC.md "KIRIM fura" -- mirrors QorovulChiqimTab.tsx's own
  // isGateWeighed/furaAwaitingKirdi/furaAwaitingChiqdi split exactly: a
  // fura never enters the weighed flow, and its Window membership is driven
  // by its OWN photos, never by kirim_orders.status -- Ombor's intake
  // confirm flips status (complete_kirim_fura, 0155) the moment every line
  // is accepted, which would yank the Chiqdi affordance out from under the
  // guard before he ever photographed the truck leaving, if status decided
  // membership instead.
  const isGateWeighed = (t: KirimTrip) => t.order.truck_type !== 'fura'

  const furaAwaitingKirdi = trips.filter((t) => !isGateWeighed(t) && !t.kirdiPhoto)
  const furaAwaitingChiqdi = trips.filter((t) => !isGateWeighed(t) && t.kirdiPhoto && !t.chiqdiPhoto)

  const notStarted = trips.filter((t) => isGateWeighed(t) && t.order.status === 'kutilmoqda' && !t.weighing)
  const inProgress = trips.filter(
    (t) => isGateWeighed(t) && t.order.status === 'kutilmoqda' && t.weighing && !t.weighing.completed_at,
  )
  // A fura leaves the active view once BOTH captures exist -- photo-driven,
  // not status-driven, for the same reason as above.
  const completed = trips.filter((t) =>
    isGateWeighed(t) ? t.order.status !== 'kutilmoqda' : Boolean(t.kirdiPhoto && t.chiqdiPhoto),
  )
  const activeWindow = [...notStarted, ...furaAwaitingKirdi, ...inProgress, ...furaAwaitingChiqdi]

  return (
    <div className="space-y-6">
      {loadError && <StatusNote tone="problem">{loadError}</StatusNote>}
      <div className="grid grid-cols-3 gap-3">
        <Stat value={notStarted.length + furaAwaitingKirdi.length} label="Kutilmoqda" />
        <Stat
          value={inProgress.length + furaAwaitingChiqdi.length}
          label="Bo'shatilmoqda"
          tone={inProgress.length + furaAwaitingChiqdi.length > 0 ? 'problem' : 'neutral'}
        />
        <Stat value={completed.length} label="Yakunlandi" tone="ok" />
      </div>
      {refreshing && <p className="text-xs text-slate-400">yangilanmoqda…</p>}

      <div>
        <SectionHeading>1 · Faol yuklar</SectionHeading>
        <div className="mt-2 space-y-2">
          {activeWindow.length === 0 && <p className="text-sm text-slate-400">Faol reys yo'q.</p>}
          {activeWindow.map((trip) => {
            // A fura's "red" state is having its entry photo but not its
            // exit one -- same two-stage shape the weighed flow has, with
            // photos in place of weights (SPEC.md "KIRIM fura").
            const isFura = !isGateWeighed(trip)
            const isRed = isFura
              ? Boolean(trip.kirdiPhoto && !trip.chiqdiPhoto)
              : Boolean(trip.weighing && !trip.weighing.completed_at)
            const isActive = activeOrderId === trip.order.order_id
            const furaStage: 'kirdi' | 'chiqdi' = trip.kirdiPhoto ? 'chiqdi' : 'kirdi'
            // Plate/driver stay in the meta line in BOTH states -- not just
            // the mockup's own "who is this truck" cue, but also how e2e
            // finds this exact row once it's red (hasText: <plate>); the
            // red-state text must not drop it in favour of the saved-weight
            // phrase alone.
            const meta = isFura
              ? isRed
                ? `Kirdi qayd etilgan · chiqish rasmi kutilmoqda · ${trip.order.driver} · ${trip.order.plate}`
                : `O'lchovsiz · moshina rasmi kutilmoqda · ${trip.order.driver} · ${trip.order.plate}`
              : isRed
                ? `Yuk bilan ${trip.weighing!.gruzheny_kg?.toLocaleString() ?? '—'} kg · bo'sh vazn kutilmoqda · ${trip.order.driver} · ${trip.order.plate}`
                : `${trip.order.declared_total != null ? `So'ralgan ${trip.order.declared_total.toLocaleString()} kg · ` : ''}${trip.order.driver} · ${trip.order.plate}`

            return (
              <Card key={trip.order.order_id} tone={isRed ? 'problem' : 'neutral'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>{primarySerial(trip)}</SerialChip>
                    <PartiyaBadge partiyaNo={primaryPartiyaNo(trip)} typeName={primaryTypeName(trip)} />
                    <FuraBadge truckType={trip.order.truck_type} />
                    {hasRezka(trip) && <RezkaBadge provenance="tashqi" />}
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(trip.order.owner_id)} · {typeSummary(trip)}
                      </span>
                    </div>
                    <div className="truncate text-sm text-slate-500 dark:text-slate-400">{meta}</div>
                  </div>
                  {!isActive && (
                    <Button
                      variant={isRed ? 'danger' : 'primary'}
                      size="lg"
                      onClick={() => {
                        setActiveOrderId(trip.order.order_id)
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
                      { label: 'Seriya', value: primarySerial(trip) },
                      { label: 'Buyurtmachi', value: ownerName(trip.order.owner_id) },
                      { label: 'Tur', value: typeSummary(trip) },
                      { label: 'Moshina · haydovchi', value: `${trip.order.plate} · ${trip.order.driver}` },
                    ]}
                    onCancel={closeForm}
                    onSubmit={(photo) => handleFuraPhoto(trip, activeStage, photo)}
                  />
                )}

                {isActive && activeStage && !isFura && (activeStage === 1 || activeStage === 2) && (
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
                    <PartiyaBadge partiyaNo={primaryPartiyaNo(trip)} typeName={primaryTypeName(trip)} />
                    <FuraBadge truckType={trip.order.truck_type} />
                    {hasRezka(trip) && <RezkaBadge provenance="tashqi" />}
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {ownerName(trip.order.owner_id)} · {typeSummary(trip)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {trip.order.driver} · {trip.order.plate}
                  </div>
                  {/* A fura's whole gate record is these two captures (SPEC.md
                      "KIRIM fura") -- the weighed flow shows a net kg here,
                      so showing nothing at all would make the row read as
                      incomplete. */}
                  {!isGateWeighed(trip) && (
                    <div className="mt-1 flex items-center gap-2">
                      <GatePhoto path={trip.kirdiPhoto} label="Moshina rasmi (kirdi)" bucket={FURA_BUCKET} thumbnail />
                      <GatePhoto path={trip.chiqdiPhoto} label="Chiqish rasmi (chiqdi)" bucket={FURA_BUCKET} thumbnail />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {isGateWeighed(trip)
                        ? `${trip.weighing?.net_kg?.toLocaleString() ?? '—'} kg`
                        : `${trip.receivedKg.toLocaleString()} kg`}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isGateWeighed(trip)
                        ? trip.weighing?.completed_at
                          ? formatTripTime(trip.weighing.completed_at)
                          : ''
                        : "fura — tortilmagan"}
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
