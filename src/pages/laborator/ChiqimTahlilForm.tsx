import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { CyclePallet } from '../../lib/useLaboratorChiqim'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'

export interface ChiqimTahlilValues {
  sampleDate: string
  sampledPallet: string
  moisturePct: number
  photoFile: File | null
  note: string
  verdict: 'o_tdi' | 'qayta_yuvish' | null
}

// §5.5.3 CHIQIM Tahlil form. Unlike KIRIM, a real pallet dropdown makes
// sense here — Barcode #2 pallets exist by this stage (§5.3 output), unlike
// KIRIM's raw-serial-only intake. Client target shown next to the moisture
// input, greyed, soft-warn only (never blocks) if the reading exceeds it —
// "misses the target" read as exceeding the client's maximum, the standard
// quality-spec direction for both moisture and sulfur in this context.
//
// `requireVerdict` controls whether this save is also the FINAL save for
// this line: a natural product (no SO2 target) has nothing left to capture
// after moisture, so its verdict happens right here; a sulfured product's
// verdict happens later, in the Sera kiritish step, once SO2 is in. No SO2
// field on this form either way — SO2 is only ever entered via Sera
// kiritish, matching the KIRIM form's identical choice (see DECISIONS.md).
export function ChiqimTahlilForm({
  targetMoisturePct,
  pallets,
  requireVerdict,
  onCancel,
  onSubmit,
}: {
  targetMoisturePct: number | null
  pallets: CyclePallet[]
  requireVerdict: boolean
  onCancel: () => void
  onSubmit: (values: ChiqimTahlilValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sampledPallet, setSampledPallet] = useState('')
  const [moisture, setMoisture] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moisturePct = parseFloat(moisture)
  const missesTarget = targetMoisturePct !== null && !isNaN(moisturePct) && moisturePct > targetMoisturePct

  async function submit(verdict: 'o_tdi' | 'qayta_yuvish' | null) {
    setError(null)
    if (!sampledPallet) {
      setError('Namuna olingan palletni tanlang.')
      return
    }
    if (isNaN(moisturePct)) {
      setError('Namligi % ni kiriting.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ sampleDate, sampledPallet, moisturePct, photoFile, note: note.trim(), verdict })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!requireVerdict) await submit(null)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
    >
      <FormField label="Sana">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      <FormField label="Namuna olingan pallet">
        <select
          required
          value={sampledPallet}
          onChange={(e) => setSampledPallet(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="" disabled>
            Tanlang…
          </option>
          {pallets.map((p) => (
            <option key={p.barcode2} value={p.barcode2}>
              {p.barcode2} · {p.weight_kg.toLocaleString()} kg
            </option>
          ))}
        </select>
      </FormField>

      {/* Not FormField here: the label carries a nested target-suffix span
          ("Namligi % (Talab: X%)"), and the e2e suite's own
          `label:text-is("Namligi %")` locator depends on "Namligi %" being
          reachable as an exact match distinct from that suffix -- confirmed
          against the live e2e contract before touching this, not assumed.
          FormField's `label` prop only accepts a plain string, so it can't
          reproduce this shape; TextInput alone (same input styling, same
          surrounding div this already had) applies the system without
          disturbing that structure. */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Namligi %{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (Talab: {targetMoisturePct !== null ? `${targetMoisturePct}%` : "Talab yo'q"})
          </span>
        </label>
        <div className="mt-1">
          <TextInput
            type="number"
            min="0"
            step="0.1"
            required
            value={moisture}
            onChange={(e) => setMoisture(e.target.value)}
          />
        </div>
        {missesTarget && (
          <div className="mt-1">
            <StatusNote tone="pending">Talabdan yuqori ({targetMoisturePct}%) — baribir saqlash mumkin.</StatusNote>
          </div>
        )}
      </div>

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

      {requireVerdict ? (
        // §5.5.3: verdict is an explicit click, never auto-derived — two
        // dedicated buttons, no generic "Saqlash" that could read as neutral.
        <div className="flex gap-2">
          <Button type="button" variant="success" size="md" disabled={submitting} onClick={() => submit('o_tdi')}>
            {submitting ? 'Saqlanmoqda…' : "O'tdi"}
          </Button>
          <Button type="button" variant="danger" size="md" disabled={submitting} onClick={() => submit('qayta_yuvish')}>
            {submitting ? 'Saqlanmoqda…' : 'Qayta yuvish'}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="lg" disabled={submitting}>
            {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      )}
    </form>
  )
}
