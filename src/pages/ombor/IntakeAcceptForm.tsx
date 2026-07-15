import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { IntakeLine } from '../../lib/useIntakeLines'

export interface IntakeAcceptValues {
  actualQty: number
  pilePhoto: File
  komment: string
}

// §5.1: declared is always visible next to actual, live variance as he
// types, red "Kam chiqdi" past the configured limit — never blocks save.
// Only the per-serial check exists here; there is no trip-level
// reconciliation against the gate net (see DECISIONS.md).
export function IntakeAcceptForm({
  line,
  typeName,
  kamChiqdiPct,
  onCancel,
  onSubmit,
}: {
  line: IntakeLine
  typeName: string
  kamChiqdiPct: number
  onCancel: () => void
  onSubmit: (values: IntakeAcceptValues) => Promise<void>
}) {
  const [actualQty, setActualQty] = useState(String(line.declared_qty))
  const [pilePhoto, setPilePhoto] = useState<File | null>(null)
  const [komment, setKomment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actual = parseFloat(actualQty) || 0
  const varianceKg = actual - line.declared_qty
  const variancePct = line.declared_qty > 0 ? (varianceKg / line.declared_qty) * 100 : 0
  const isKamChiqdi = variancePct < -kamChiqdiPct

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (actualQty === '' || actual < 0) {
      setError('Aniq miqdorni kiriting.')
      return
    }
    if (!pilePhoto) {
      setError('Uyum rasmi majburiy.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ actualQty: actual, pilePhoto, komment })
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
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-slate-500 dark:text-slate-400">Seriya</div>
          <div className="font-mono text-slate-900 dark:text-slate-100">{line.serial}</div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-400">Tur</div>
          <div className="text-slate-900 dark:text-slate-100">{typeName}</div>
        </div>
        <div>
          <div className="text-slate-500 dark:text-slate-400">Buyurtma (kutilgan, kg)</div>
          <div className="text-slate-900 dark:text-slate-100">{line.declared_qty.toLocaleString()}</div>
        </div>
        <div>
          <label className="block text-slate-500 dark:text-slate-400" htmlFor={`actual-${line.serial}`}>
            Aniq (kg)
          </label>
          <input
            id={`actual-${line.serial}`}
            type="number"
            min="0"
            step="0.1"
            required
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      <p
        className={
          isKamChiqdi
            ? 'text-sm font-medium text-red-600 dark:text-red-400'
            : 'text-sm text-slate-500 dark:text-slate-400'
        }
      >
        Farq: {varianceKg >= 0 ? '+' : ''}
        {varianceKg.toLocaleString()} kg ({variancePct >= 0 ? '+' : ''}
        {variancePct.toFixed(1)}%){isKamChiqdi && ' — Kam chiqdi'}
      </p>

      <PhotoField label="Uyum rasmi" required onChange={setPilePhoto} />

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Komment (ixtiyoriy)</label>
        <input
          type="text"
          value={komment}
          onChange={(e) => setKomment(e.target.value)}
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
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {submitting ? 'Saqlanmoqda…' : 'Qabul qilish'}
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
