import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'

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
      <FormField label="Sana">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      <FormField label="Namligi %">
        <TextInput
          type="number"
          min="0"
          step="0.1"
          required
          value={moisture}
          onChange={(e) => setMoisture(e.target.value)}
        />
      </FormField>

      <PhotoField label="Namuna rasmi (ixtiyoriy)" onChange={setPhotoFile} />

      <FormField label="Nuqson/begona modda qaydi (ixtiyoriy)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </FormField>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}
