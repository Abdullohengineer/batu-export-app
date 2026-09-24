import { useState } from 'react'
import type { RezkaSerial } from '../../lib/useRezkaSerials'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { RezkaBadge } from '../../components/ui/RezkaBadge'

// "Tashqaridan olish" (SPEC.md §5.R, Rezka Prompt 2): send raw from a
// process='rezka' delivery serial to Rezka. Mirrors NewStockToMoykaForm's
// chip-picker + weighed-kg flow, except it STAYS OPEN after a save (the
// serial's balance refreshes in place) so Ombor can send the same truck in
// several batches. Over-send is allowed exactly as on Moyka: `available`
// guides, it never caps, and -- like the Moyka form -- there is no extra
// warning for it.
export function TashqiToRezkaForm({
  serials,
  typeName,
  ownerName,
  onCancel,
  onSubmit,
}: {
  serials: RezkaSerial[]
  typeName: (id: string) => string
  ownerName: (id: string) => string
  onCancel: () => void
  onSubmit: (serial: RezkaSerial, qtyKg: number) => Promise<void>
}) {
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [weighedKg, setWeighedKg] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<number | null>(null)

  const candidates = serials.filter((s) => s.available > 0)
  // Looked up in the full list, not `candidates`: a batch that brings the
  // balance to 0 must not yank the form away mid-session.
  const selected = serials.find((s) => s.serial === selectedSerial) ?? null
  const weighedNum = parseFloat(weighedKg)
  const hasWeighed = weighedNum > 0

  async function handleSubmit() {
    if (!selected) return
    setError(null)
    if (!hasWeighed) {
      setError("Tarozidagi og'irlikni kiriting.")
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(selected, weighedNum)
      setLastSent(weighedNum)
      setWeighedKg('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card tone="pending">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Tashqaridan olish</span>
        <RezkaBadge provenance="tashqi" />
      </div>

      {!selected ? (
        candidates.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">Rezkaga yuboriladigan xom ashyo yo'q.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidates.map((s) => (
              <button
                key={s.serial}
                type="button"
                onClick={() => {
                  setSelectedSerial(s.serial)
                  setLastSent(null)
                  setError(null)
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="font-mono">{s.serial}</span>
                <PartiyaBadge partiyaNo={s.partiyaNo} typeName={typeName(s.type_id)} />
                <span className="ml-1.5">
                  {ownerName(s.owner_id)} · {typeName(s.type_id)} · ~{Math.round(s.available).toLocaleString()} kg
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="mt-2 space-y-2 border-t border-violet-200 pt-2 dark:border-violet-900">
          <div className="flex items-center justify-between text-sm">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{selected.serial}</span>
            <span className="text-slate-600 dark:text-slate-300">
              {ownerName(selected.owner_id)} · {typeName(selected.type_id)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Kitob bo'yicha qoldiq</span>
            <span className="font-medium text-slate-600 dark:text-slate-300">~{Math.round(selected.available).toLocaleString()} kg</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="tashqi-rezka-weighed">
              Tarozidagi og'irlik <span className="font-normal text-slate-400">(majburiy)</span>
            </label>
            <div className="mt-1">
              <TextInput
                id="tashqi-rezka-weighed"
                type="number"
                min="0"
                step="0.1"
                required
                placeholder="Tarozidan o'qing"
                value={weighedKg}
                onChange={(e) => setWeighedKg(e.target.value)}
                className="!text-2xl font-bold"
              />
            </div>
          </div>

          {lastSent !== null && <StatusNote tone="ok">{lastSent.toLocaleString()} kg Rezkaga yuborildi.</StatusNote>}
          {error && <StatusNote tone="problem">{error}</StatusNote>}

          <div className="space-y-2">
            <Button type="button" variant="primary" size="lg" fullWidth disabled={submitting || !hasWeighed} onClick={handleSubmit}>
              {submitting ? 'Yuborilmoqda…' : 'Rezkaga yuborish'}
            </Button>
            <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
              Yopish
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
