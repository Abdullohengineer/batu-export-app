import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { IntakeLine } from '../../lib/useIntakeLines'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { toneStyles } from '../../components/ui/tokens'

export interface IntakeAcceptValues {
  actualQty: number
  pilePhoto: File
  komment: string
}

// §5.1: declared is always visible next to actual, live variance as he
// types, red "Kam chiqdi" past the configured limit — never blocks save.
// Only the per-serial check exists here; there is no trip-level
// reconciliation against the gate net (see DECISIONS.md).
function todayLabel() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

export function IntakeAcceptForm({
  line,
  typeName,
  ownerName,
  kamChiqdiPct,
  onCancel,
  onSubmit,
}: {
  line: IntakeLine
  typeName: string
  ownerName: string
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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{line.serial}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Egasi · tur</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {ownerName} · {typeName}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Moshina · haydovchi</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {line.plate} · {line.driver}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">E'lon qilingan</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{line.declared_qty.toLocaleString()} kg</span>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Sana</div>
        <div className="mt-1 text-base text-slate-900 dark:text-slate-100">{todayLabel()}</div>
      </div>

      {/* Not FormField: the label's `htmlFor` pairs explicitly with this
          input's `id` (`#actual-${serial}`, an e2e locator target) --
          FormField's label doesn't accept htmlFor, so this field keeps its
          own label and uses TextInput directly, same resolution as
          ChiqimTahlilForm's composite-label field. */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor={`actual-${line.serial}`}>
          Haqiqiy og'irlik
        </label>
        <div className="mt-1">
          <TextInput
            id={`actual-${line.serial}`}
            type="number"
            min="0"
            step="0.1"
            required
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            className="!text-2xl font-bold"
          />
        </div>
        <p className={`mt-1 text-sm ${isKamChiqdi ? `font-medium ${toneStyles.problem.text}` : 'text-slate-500 dark:text-slate-400'}`}>
          Farq: {varianceKg >= 0 ? '+' : ''}
          {varianceKg.toLocaleString()} kg ({variancePct >= 0 ? '+' : ''}
          {variancePct.toFixed(1)}%){isKamChiqdi && ' — Kam chiqdi'}
        </p>
      </div>

      <PhotoField label="Uyum rasmi" required onChange={setPilePhoto} />

      <FormField label="Komment (ixtiyoriy)">
        <TextInput type="text" value={komment} onChange={(e) => setKomment(e.target.value)} />
      </FormField>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="space-y-2">
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : 'Qabul qilish va shtrix-kod chiqarish'}
        </Button>
        <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}
