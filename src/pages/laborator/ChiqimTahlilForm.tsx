import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { CyclePallet } from '../../lib/useLaboratorChiqim'

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
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Namuna olingan pallet</label>
        <select
          required
          value={sampledPallet}
          onChange={(e) => setSampledPallet(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Namligi %{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (Talab: {targetMoisturePct !== null ? `${targetMoisturePct}%` : "Talab yo'q"})
          </span>
        </label>
        <input
          type="number"
          min="0"
          step="0.1"
          required
          value={moisture}
          onChange={(e) => setMoisture(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {missesTarget && (
          <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400" role="status">
            Talabdan yuqori ({targetMoisturePct}%) — baribir saqlash mumkin.
          </p>
        )}
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

      {requireVerdict ? (
        // §5.5.3: verdict is an explicit click, never auto-derived — two
        // dedicated buttons, no generic "Saqlash" that could read as neutral.
        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit('o_tdi')}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Saqlanmoqda…' : "O'tdi"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit('qayta_yuvish')}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {submitting ? 'Saqlanmoqda…' : 'Qayta yuvish'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            Bekor qilish
          </button>
        </div>
      ) : (
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
      )}
    </form>
  )
}
