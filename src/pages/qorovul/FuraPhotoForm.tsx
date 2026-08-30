import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import type { TripInfoRow } from './GateStageForm'

// Fura gate capture (2026-08-30, see DECISIONS.md "Fura CHIQIM gate
// photos"). Deliberately NOT GateStageForm: that form's whole subject is a
// weight reading, and a fura is never weighed — reusing it would mean
// threading a "no weight" mode through every branch of a form whose
// required-field logic is built around the weight field. This is the same
// shape (Card, tripInfo rows, PhotoField, confirm/cancel) with one input.
//
// PhotoField is reused as-is, so compression and the real-device
// compression-failure path (DECISIONS.md "Qorovul photo upload silent
// failure") come along unchanged — that failure clears the file to null,
// which is exactly why `disabled` below tests the file rather than a
// separate "attached" flag.
export function FuraPhotoForm({
  stage,
  tripInfo,
  onCancel,
  onSubmit,
}: {
  stage: 'kirdi' | 'chiqdi'
  tripInfo?: TripInfoRow[]
  onCancel: () => void
  onSubmit: (photo: File) => Promise<void>
}) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEntry = stage === 'kirdi'
  const label = isEntry ? 'Moshina rasmi' : 'Nakladnoy rasmi'
  const subtitle = isEntry
    ? "Fura kirdi — o'lchanmaydi, faqat moshina rasmi olinadi"
    : "Fura chiqdi — o'lchanmaydi, faqat nakladnoy rasmi olinadi"

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Reactive check kept as defense in depth alongside the disabled button
    // below, same belt-and-braces GateStageForm uses.
    if (!photo) {
      setError(`${label} majburiy.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(photo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card padding="compact" className="mt-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>

        {tripInfo && (
          <dl className="space-y-1 text-sm">
            {tripInfo.map((row) => (
              <div key={row.label} className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">{row.label}</dt>
                <dd className="text-right font-medium text-slate-900 dark:text-slate-100">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <PhotoField label={label} required onChange={setPhoto} />

        {error && <StatusNote tone="problem">{error}</StatusNote>}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="lg" disabled={!photo || submitting}>
            {submitting ? 'Saqlanmoqda…' : isEntry ? 'Kirdi' : 'Chiqdi'}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
            Bekor qilish
          </Button>
        </div>
      </form>
    </Card>
  )
}
