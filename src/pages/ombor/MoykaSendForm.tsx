import { useState, type FormEvent } from 'react'
import type { MoykaSerial } from '../../lib/useMoykaSerials'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/FormField'

function todayLabel() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

// §5.2 send form: quantity input with live "Qoladi" (available − in-progress
// input, updated as he types). Over-send is blocked — you can't send more raw
// than is available (a negative balance is nonsensical, unlike the discretionary
// declared-vs-actual variance at intake). The persisted balance stays
// server-derived (Σ moyka_sends) after save. Defaults to the full available
// balance (same "pre-fill with the figure that's already known" convention
// IntakeAcceptForm uses for its own weight field) — usually sent in full, and
// still freely editable down for a partial send.
export function MoykaSendForm({
  serial,
  typeName,
  ownerName,
  onCancel,
  onSubmit,
}: {
  serial: MoykaSerial
  typeName: string
  ownerName: string
  onCancel: () => void
  onSubmit: (qtyKg: number) => Promise<void>
}) {
  const [qty, setQty] = useState(String(serial.available))
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
          <span className="text-slate-500 dark:text-slate-400">Omborda qoldiq</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{serial.available.toLocaleString()} kg</span>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Sana</div>
        <div className="mt-1 text-base text-slate-900 dark:text-slate-100">{todayLabel()}</div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`qty-${serial.serial}`}>
          Og'irlik
        </label>
        <div className="mt-1">
          <TextInput
            id={`qty-${serial.serial}`}
            type="number"
            min="0"
            step="0.1"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="!text-2xl font-bold"
          />
        </div>
        <p className={`mt-1 text-sm ${overSend ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
          Qoladi: {qoladi.toLocaleString()} kg
          {overSend && ' — mavjud qoldiqdan ko\'p'}
        </p>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
          {submitting ? 'Yuborilmoqda…' : 'Moykaga yuborish'}
        </Button>
        <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
      <p className="text-center text-xs text-slate-400">Yuborilgach seriya "Moykada" ro'yxatiga o'tadi</p>
    </form>
  )
}
