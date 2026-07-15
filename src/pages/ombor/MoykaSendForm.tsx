import { useState, type FormEvent } from 'react'
import type { MoykaSerial } from '../../lib/useMoykaSerials'

// §5.2 send form: quantity input with live "Qoladi" (available − in-progress
// input, updated as he types). Over-send is blocked — you can't send more raw
// than is available (a negative balance is nonsensical, unlike the discretionary
// declared-vs-actual variance at intake). The persisted balance stays
// server-derived (Σ moyka_sends) after save.
export function MoykaSendForm({
  serial,
  onCancel,
  onSubmit,
}: {
  serial: MoykaSerial
  onCancel: () => void
  onSubmit: (qtyKg: number) => Promise<void>
}) {
  const [qty, setQty] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qtyNum = parseFloat(qty) || 0
  const qoladi = serial.available - qtyNum
  const overSend = qtyNum > serial.available

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (qtyNum <= 0) {
      setError('Miqdorni kiriting.')
      return
    }
    if (overSend) {
      setError('Mavjud qoldiqdan ko\'p yubora olmaysiz.')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(qtyNum)
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
        <label className="block text-sm text-slate-500 dark:text-slate-400" htmlFor={`qty-${serial.serial}`}>
          Miqdori (kg)
        </label>
        <input
          id={`qty-${serial.serial}`}
          type="number"
          min="0"
          step="0.1"
          required
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <p className={overSend ? 'text-sm font-medium text-red-600 dark:text-red-400' : 'text-sm text-slate-600 dark:text-slate-300'}>
        Qoladi: {qoladi.toLocaleString()} kg
        {overSend && ' — mavjud qoldiqdan ko\'p'}
      </p>

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
          {submitting ? 'Yuborilmoqda…' : 'Moykaga yuborish'}
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
