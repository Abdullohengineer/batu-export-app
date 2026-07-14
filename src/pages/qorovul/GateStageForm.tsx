import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'

export interface GateStageValues {
  weightKg: number
  platePhoto?: File
  scalePhoto: File
}

// §4: both stages, both directions require a weight-reading (tarozi) photo.
// No soft warnings here — just required-field checks (submit is blocked
// until the required photos are attached).
export function GateStageForm({
  stage,
  onCancel,
  onSubmit,
}: {
  stage: 1 | 2
  onCancel: () => void
  onSubmit: (values: GateStageValues) => Promise<void>
}) {
  const [weightKg, setWeightKg] = useState('')
  const [platePhoto, setPlatePhoto] = useState<File | null>(null)
  const [scalePhoto, setScalePhoto] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weightLabel = stage === 1 ? 'Yuk bilan vazn (Гружёный)' : "Bo'sh vazn (Пустой)"

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

    setSubmitting(true)
    try {
      await onSubmit({ weightKg: weight, platePhoto: platePhoto ?? undefined, scalePhoto })
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

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{weightLabel}</label>
        <input
          type="number"
          min="0"
          step="0.1"
          required
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <PhotoField label="Tarozi rasmi" required onChange={setScalePhoto} />

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {submitting ? 'Saqlanmoqda…' : stage === 1 ? 'Qabul qilish' : 'Yakunlash'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          Bekor qilish
        </button>
      </div>
    </form>
  )
}
