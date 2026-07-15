import { useMemo, useState, type FormEvent } from 'react'
import type { Calibre } from '../../lib/useCalibres'
import type { OutputSerial } from '../../lib/useMoykaOutput'

export interface ReceiptValues {
  calibreId: string
  weightKg: number
  barcode2: string
}

// §5.3 daily receipt form: one pallet per save. Tur is read-only (auto-filled
// from the parent serial — single-type by construction, §2.1). Kalibr dropdown
// (incl. Konditirskiy) filtered to the serial's category. Og'irlik → weight.
// The Barcode #2 sticker ID is generated here: PLT-<serial>-<calibre code>-<seq>,
// where seq disambiguates multiple pallets of the same serial+calibre (see
// DECISIONS — the §2.2 format needed a per-pallet uniquifier).
export function FinishedReceiptForm({
  serial,
  typeName,
  calibres,
  onCancel,
  onSubmit,
}: {
  serial: OutputSerial
  typeName: string
  calibres: Calibre[]
  onCancel: () => void
  onSubmit: (values: ReceiptValues) => Promise<void>
}) {
  const categoryCalibres = useMemo(
    () => calibres.filter((c) => c.category_id === serial.category_id),
    [calibres, serial.category_id],
  )
  const [calibreId, setCalibreId] = useState('')
  const [weight, setWeight] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function nextBarcode2(code: string): string {
    // seq = count of existing non-void pallets of this serial+calibre + 1.
    // The finished_pallets PK is the backstop against a concurrent collision
    // (single ombor manager, one-pallet-per-save → collisions are unlikely).
    const existing = serial.pallets.filter((p) => p.calibre_id === calibreId).length
    return `PLT-${serial.serial}-${code}-${existing + 1}`
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cal = categoryCalibres.find((c) => c.id === calibreId)
    const w = parseFloat(weight)
    if (!cal) {
      setError('Kalibrni tanlang.')
      return
    }
    if (!w || w <= 0) {
      setError("Og'irlikni kiriting.")
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ calibreId, weightKg: w, barcode2: nextBarcode2(cal.code) })
      setCalibreId('')
      setWeight('')
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
          <div className="text-slate-500 dark:text-slate-400">Tur</div>
          <div className="text-slate-900 dark:text-slate-100">{typeName}</div>
        </div>
        <div>
          <label className="block text-slate-500 dark:text-slate-400" htmlFor={`cal-${serial.serial}`}>
            Kalibr
          </label>
          <select
            id={`cal-${serial.serial}`}
            required
            value={calibreId}
            onChange={(e) => setCalibreId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="" disabled>
              Tanlang…
            </option>
            {categoryCalibres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm text-slate-500 dark:text-slate-400" htmlFor={`w-${serial.serial}`}>
          Og'irlik (kg)
        </label>
        <input
          id={`w-${serial.serial}`}
          type="number"
          min="0"
          step="0.1"
          required
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      {categoryCalibres.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Kalibrlar sozlanmagan (calibres bo'sh). Administrator kalibrlarni kiritishi kerak.
        </p>
      )}
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
          Yopish
        </button>
      </div>
    </form>
  )
}
