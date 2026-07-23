import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

export interface GateStageValues {
  weightKg: number
  platePhoto?: File
  scalePhoto: File
  departureDocPhoto?: File
}

export interface TripInfoRow {
  label: string
  value: string
}

const SUBTITLE: Record<'kirim' | 'chiqim', [string, string]> = {
  kirim: ['Mashina yuk bilan keldi — kirishda o\'lchanadi', 'Yuk tushirilgach, mashina chiqishdan oldin o\'lchanadi'],
  chiqim: ["Mashina bo'sh keldi — yuklashdan oldin o'lchanadi", "Yuklangach, mashina chiqishdan oldin o'lchanadi"],
}

// §4: both stages, both directions require a weight-reading (tarozi) photo.
// Required-field checks stay reactive (on submit, as before) AND are now
// also enforced proactively -- the confirm button stays disabled until
// every required field is present, per mockup "BATU-Qorovul-Screens-
// v1_1.pdf". Reactive checks are kept as defense in depth, not replaced.
//
// `dir` and `requireDepartureDoc` default to KIRIM's original behavior --
// this same form (not a new one) also serves CHIQIM's gate flow, which
// reverses which stage records which weight and adds a third mandatory
// photo at stage 2.
//
// `tripInfo`/`savedWeightKg` (nav/visual-redesign pass) are presentational
// only, built entirely from data the parent tabs already fetch in full
// (order/request/lines/weighing) -- not from any new query. `tripInfo`
// deliberately has no "Buyurtmachi" (owner) row: neither useKirimTrips.ts
// nor useChiqimTrips.ts selects an owner reference at all, and adding one
// would mean widening an existing .select() -- a data-shape change the
// task's own guardrail rules out. Flagged in docs/DECISIONS.md rather than
// built. `tripInfo` is only ever passed at stage 1 (the mockup's own stage-2
// screens drop the full manager-values block, showing just the saved weight
// below instead) and `savedWeightKg` only at stage 2.
export function GateStageForm({
  stage,
  dir = 'kirim',
  requireDepartureDoc = false,
  tripInfo,
  savedWeightKg,
  onCancel,
  onSubmit,
}: {
  stage: 1 | 2
  dir?: 'kirim' | 'chiqim'
  requireDepartureDoc?: boolean
  tripInfo?: TripInfoRow[]
  savedWeightKg?: number
  onCancel: () => void
  onSubmit: (values: GateStageValues) => Promise<void>
}) {
  const [weightKg, setWeightKg] = useState('')
  const [platePhoto, setPlatePhoto] = useState<File | null>(null)
  const [scalePhoto, setScalePhoto] = useState<File | null>(null)
  const [departureDocPhoto, setDepartureDocPhoto] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // KIRIM: stage 1 = loaded arrival (Гружёный), stage 2 = empty departure
  // (Пустой). CHIQIM reverses this — stage 1 = empty arrival (Пустой),
  // stage 2 = loaded departure (Гружёный) — confirmed from SPEC §4's table,
  // not assumed.
  const loaded = 'Yuk bilan vazn (Гружёный)'
  const empty = "Bo'sh vazn (Пустой)"
  const loadedTitle = 'Yuk bilan vazn'
  const emptyTitle = "Bo'sh vazn"
  const weightLabel = dir === 'kirim' ? (stage === 1 ? loaded : empty) : stage === 1 ? empty : loaded
  const stageTitle = dir === 'kirim' ? (stage === 1 ? loadedTitle : emptyTitle) : stage === 1 ? emptyTitle : loadedTitle
  // The OTHER stage's already-known weight -- e.g. at KIRIM stage 2 the
  // current field is the empty weight, so the already-saved one is loaded.
  const savedLabel = stage === 2 ? (dir === 'kirim' ? loadedTitle : emptyTitle) : null
  const subtitle = SUBTITLE[dir][stage - 1]

  const helperCaption =
    stage === 1
      ? dir === 'kirim'
        ? "Vazn va tarozi rasmi to'ldirilgach saqlanadi — qizil qatorga o'tadi"
        : "Saqlangach — ombor yuklashni boshlaydi, qizil qatorga o'tadi"
      : requireDepartureDoc
        ? "Yakunlash — vazn, vazn rasmi va chiqish hujjati to'ldirilgach ochiladi"
        : "Yakunlash — vazn va rasm to'ldirilgach ochiladi"

  const weight = parseFloat(weightKg)
  const canSubmit =
    Boolean(weight) &&
    weight > 0 &&
    Boolean(scalePhoto) &&
    (stage !== 1 || Boolean(platePhoto)) &&
    (!requireDepartureDoc || Boolean(departureDocPhoto))

  // Live preview only -- net_kg itself stays a generated column (§2.15),
  // computed server-side exactly as before; this just echoes the same
  // subtraction ahead of submit using values already in the browser.
  const netPreview =
    stage === 2 && savedWeightKg !== undefined && weight > 0
      ? dir === 'kirim'
        ? savedWeightKg - weight
        : weight - savedWeightKg
      : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const w = parseFloat(weightKg)
    if (!w || w <= 0) {
      setError('Vaznni kiriting.')
      return
    }
    if (stage === 1 && !platePhoto) {
      setError('Moshina raqami rasmi majburiy.')
      return
    }
    if (!scalePhoto) {
      setError('Tarozi rasmi majburiy.')
      return
    }
    if (requireDepartureDoc && !departureDocPhoto) {
      setError('Chiqish hujjati rasmi majburiy.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        weightKg: w,
        platePhoto: platePhoto ?? undefined,
        scalePhoto,
        departureDocPhoto: departureDocPhoto ?? undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <StatusPill tone={stage === 1 ? 'ok' : 'problem'}>
        {dir === 'kirim' ? 'KIRIM' : 'CHIQIM'} · BOSQICH {stage}
      </StatusPill>

      <div>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{stageTitle}</div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>

      {tripInfo && (
        <Card padding="compact" className="space-y-1">
          {tripInfo.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-500 dark:text-slate-400">{row.label}</span>
              <span className="text-right font-medium text-slate-900 dark:text-slate-100">{row.value}</span>
            </div>
          ))}
        </Card>
      )}

      {stage === 1 && <PhotoField label="Moshina raqami rasmi" required onChange={setPlatePhoto} />}

      {savedLabel && savedWeightKg !== undefined && (
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{savedLabel} (saqlangan)</div>
            <div className="text-base font-semibold tabular-nums text-slate-700 dark:text-slate-300">
              {savedWeightKg.toLocaleString()} kg
            </div>
          </div>
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">rasm bor</span>
        </div>
      )}

      <FormField label={weightLabel}>
        <div className="relative">
          <TextInput
            type="number"
            min="0"
            step="0.1"
            required
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            className="!text-3xl !font-bold !pr-12"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">kg</span>
        </div>
      </FormField>

      <PhotoField label="Tarozi rasmi" required onChange={setScalePhoto} />

      {requireDepartureDoc && <PhotoField label="Chiqish hujjati rasmi" required onChange={setDepartureDocPhoto} />}

      {netPreview !== null && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center dark:border-blue-900 dark:bg-blue-950/30">
          <span className="text-base font-semibold text-blue-700 dark:text-blue-400">
            Yuk og'irligi (avto): {netPreview.toLocaleString()} kg
          </span>
        </div>
      )}

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="space-y-1">
        <Button type="submit" variant={stage === 1 ? 'primary' : 'danger'} size="lg" fullWidth disabled={submitting || !canSubmit}>
          {submitting ? 'Saqlanmoqda…' : stage === 1 ? 'Qabul qilish' : 'Yakunlash'}
        </Button>
        <p className="text-center text-xs text-slate-400">{helperCaption}</p>
        <div className="text-center">
          <Button type="button" variant="ghost" size="md" onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      </div>
    </form>
  )
}
