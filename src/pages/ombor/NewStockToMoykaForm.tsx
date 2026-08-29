import { useState } from 'react'
import type { MoykaSerial } from '../../lib/useMoykaSerials'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// §5.2 Yangi zaxira tile (two-tile picker redesign, 2026-08-28 — see
// DECISIONS.md same date). Picks ONE raw serial by chip — serial + Qoldiq
// kg only, no company/type/kalibr dropdowns, since product identity is
// already fixed by the serial (a serial is single-type by construction,
// §2.1) — this picker's only job is "which serial," never "which product."
//
// Deliberately mirrors OldStockToMoykaForm's shape (book figure shown as
// plain text, weight input starts empty, never capped), NOT
// MoykaSendForm's (pre-filled from `available`, blocks over-send) —
// MoykaSendForm is retired by this redesign. Over-send is allowed here:
// the entered weight is what's actually on the scale, `available` is a
// reference only, and the live signed-loss model (0086) already handles
// an over-send correctly (same §2.15.2 edge case this app has always had).
export function NewStockToMoykaForm({
  serials,
  onCancel,
  onSubmit,
}: {
  serials: MoykaSerial[]
  onCancel: () => void
  onSubmit: (serial: MoykaSerial, qtyKg: number) => Promise<void>
}) {
  const available = serials.filter((s) => s.available > 0)
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [weighedKg, setWeighedKg] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const selected = available.find((s) => s.serial === selectedSerial) ?? null
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
      // Brief inline confirmation, then collapse back to the two-tile
      // default view — this app has no toast primitive (confirmed before
      // building this), so this matches its one existing success/error
      // idiom (StatusNote) instead of inventing a new UI pattern.
      setSent(true)
      setTimeout(onCancel, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <Card tone="pending">
        <StatusNote tone="ok">Yuborildi.</StatusNote>
      </Card>
    )
  }

  return (
    <Card tone="pending">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">Yangi zaxiradan moykaga yuborish</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
          Yangi zaxira
        </span>
      </div>

      {!selected ? (
        available.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">Yuboriladigan xom ashyo yo'q.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {available.map((s) => (
              <button
                key={s.serial}
                type="button"
                onClick={() => setSelectedSerial(s.serial)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="font-mono">{s.serial}</span>
                <PartiyaBadge partiyaNo={s.partiyaNo} />
                {/* '~' marks Qoldiq as a reference figure, same convention
                    OldStockToMoykaForm's own book-weight chips use. */}
                <span className="ml-1.5">~{Math.round(s.available).toLocaleString()} kg</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="mt-2 space-y-2 border-t border-amber-200 pt-2 dark:border-amber-900">
          {/* Reference only — plain text, not an input, so it can never be
              mistaken for the figure actually being recorded (same reasoning
              OldStockToMoykaForm's own "Kitob bo'yicha" line documents). */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">Kitob bo'yicha (1 ta seriya)</span>
            <span className="font-medium text-slate-600 dark:text-slate-300">~{Math.round(selected.available).toLocaleString()} kg</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="new-stock-weighed">
              Tarozidagi og'irlik <span className="font-normal text-slate-400">(majburiy)</span>
            </label>
            <div className="mt-1">
              <TextInput
                id="new-stock-weighed"
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

          {error && <StatusNote tone="problem">{error}</StatusNote>}

          <div className="space-y-2">
            <Button type="button" variant="primary" size="lg" fullWidth disabled={submitting || !hasWeighed} onClick={handleSubmit}>
              {submitting ? 'Yuborilmoqda…' : 'Moykaga yuborish'}
            </Button>
            <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
              Bekor qilish
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
