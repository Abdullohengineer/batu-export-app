import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'

export interface TahlilValues {
  sampleDate: string
  moisturePct: number
  photoFile: File | null
  note: string
}

// §5.5.2 KIRIM Tahlil form: sana · Namligi % · optional photo · optional
// note. No SO2 field here regardless of whether the line has a sulfur
// target — SO2 is a separate later capture (Sera kiritish, W2), never
// entered at Tahlil time even for sulfured products (the ~1-day lab wait is
// real, SPEC.md §5.5.1). Whether this line's target exists at all only
// decides what happens to the row AFTER save (moves to W2 vs. straight to
// W3) — decided by the caller, not this form.
export function KirimTahlilForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (values: TahlilValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [moisture, setMoisture] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const moisturePct = parseFloat(moisture)
    if (!moisturePct && moisturePct !== 0) {
      setError('Namligi % ni kiriting.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ sampleDate, moisturePct, photoFile, note: note.trim() })
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
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Sana</label>
        <input
          type="date"
          required
          value={sampleDate}
          onChange={(e) => setSampleDate(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Namligi %</label>
        <input
          type="number"
          min="0"
          step="0.1"
          required
          value={moisture}
          onChange={(e) => setMoisture(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <PhotoField label="Namuna rasmi (ixtiyoriy)" onChange={setPhotoFile} />

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Nuqson/begona modda qaydi (ixtiyoriy)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
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
