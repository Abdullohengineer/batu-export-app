import { useMemo, useState, type FormEvent } from 'react'
import type { Calibre } from '../../lib/useCalibres'
import type { OutputSerial } from '../../lib/useMoykaOutput'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'

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
function todayLabel() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

export function FinishedReceiptForm({
  serial,
  typeName,
  ownerName,
  calibres,
  onCancel,
  onSubmit,
}: {
  serial: OutputSerial
  typeName: string
  ownerName: string
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
    // §5.5.5: seq counts EVERY pallet ever made for this serial+calibre —
    // every cycle, including voided ones (barcodeSeqByCalibre, unlike
    // `serial.pallets`, is deliberately NOT scoped to the active cycle).
    // barcode2 is a permanent PK (void-never-delete), so a re-wash cycle's
    // first same-calibre pallet must not reuse a sequence number a voided
    // cycle already claimed. The finished_pallets PK is the backstop
    // against a concurrent collision (single ombor manager, one-pallet-
    // per-save → collisions are unlikely).
    const existing = serial.barcodeSeqByCalibre[calibreId] ?? 0
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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{serial.serial}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Egasi · tur</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {ownerName} · {typeName}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Shu paytgacha qabul</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{serial.received.toLocaleString()} kg</span>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Sana</div>
        <div className="mt-1 text-base text-slate-900 dark:text-slate-100">{todayLabel()}</div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`cal-${serial.serial}`}>
          Kalibr
        </label>
        <select
          id={`cal-${serial.serial}`}
          required
          value={calibreId}
          onChange={(e) => setCalibreId(e.target.value)}
          className="mt-1 min-h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`w-${serial.serial}`}>
          Og'irlik
        </label>
        <div className="mt-1">
          <TextInput
            id={`w-${serial.serial}`}
            type="number"
            min="0"
            step="0.1"
            required
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="!text-2xl font-bold"
          />
        </div>
      </div>

      {categoryCalibres.length === 0 && (
        <StatusNote tone="pending">Kalibrlar sozlanmagan (calibres bo'sh). Administrator kalibrlarni kiritishi kerak.</StatusNote>
      )}
      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="space-y-2">
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : 'Saqlash va shtrix-kod chiqarish'}
        </Button>
        <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
          Yopish
        </Button>
      </div>
    </form>
  )
}
