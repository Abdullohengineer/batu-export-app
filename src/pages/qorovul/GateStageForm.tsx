import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'

export interface GateStageValues {
  weightKg: number
  platePhoto?: File
  scalePhoto: File
  departureDocPhoto?: File
}

// §4: both stages, both directions require a weight-reading (tarozi) photo.
// No soft warnings here — just required-field checks (submit is blocked
// until the required photos are attached).
//
// `dir` and `requireDepartureDoc` default to KIRIM's original behavior —
// added so this same form (not a new one) also serves CHIQIM's gate flow,
// which reverses which stage records which weight and adds a third
// mandatory photo at stage 2. Existing KIRIM call sites need no changes.
export function GateStageForm({
  stage,
  dir = 'kirim',
  requireDepartureDoc = false,
  onCancel,
  onSubmit,
}: {
  stage: 1 | 2
  dir?: 'kirim' | 'chiqim'
  requireDepartureDoc?: boolean
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
  const weightLabel = dir === 'kirim' ? (stage === 1 ? loaded : empty) : stage === 1 ? empty : loaded

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const weight = parseFloat(weightKg)
    if (!weight || weight <= 0) {
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
        weightKg: weight,
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
      className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
    >
      {stage === 1 && <PhotoField label="Moshina raqami rasmi" required onChange={setPlatePhoto} />}

      <FormField label={weightLabel}>
        <TextInput
          type="number"
          min="0"
          step="0.1"
          required
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
        />
      </FormField>

      <PhotoField label="Tarozi rasmi" required onChange={setScalePhoto} />

      {requireDepartureDoc && (
        <PhotoField label="Chiqish hujjati rasmi" required onChange={setDepartureDocPhoto} />
      )}

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : stage === 1 ? 'Qabul qilish' : 'Yakunlash'}
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}
