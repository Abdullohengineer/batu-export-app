import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useStockOnHand } from '../../lib/useStockOnHand'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'

// Opening stock, Stage 3 (2026-08-02, see DECISIONS.md "Opening stock,
// Stage 3") — re-washing old washed stock. Ombor picks whole old pallets by
// type+calibre; submitting consumes them, mints a brand-new serial
// (origin='internal_reprocess') and sends that serial to Moyka in ONE
// transaction via send_old_stock_to_moyka.
//
// The two figures are deliberately NOT the same field:
//   "Kitob bo'yicha" is the sum of the picked pallets' book weights — a
//   read-only REFERENCE. Those weights were estimated over a year ago and
//   the material has since lost mass to dehydration.
//   "Tarozidagi og'irlik" starts EMPTY and is never pre-filled from the
//   book total (deliberately breaking MoykaSendForm's own pre-fill
//   convention — see that file's comment). Ombor must read a real scale.
// Trusting the book figure would fold a year of storage shrinkage into wash
// loss: a pallet booked at 720 kg but actually holding 650, washed at 10%
// real loss, would record ~19%. The gap between the two is storage loss and
// is reported separately, never mixed into processing loss.
export function OldStockToMoykaForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { rows: stockRows, loading: stockLoading } = useStockOnHand()

  const [ownerId, setOwnerId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [calibreId, setCalibreId] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [weighedKg, setWeighedKg] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The same stock_on_hand_rows the qoldig'i Eski zaxira toggle reads —
  // never a second source of truth for what's actually on the floor.
  // bucket='available' already excludes anything reserved to an open CHIQIM
  // request or awaiting lab; the mint RPC re-checks all of it server-side
  // anyway, since a picker can always go stale.
  const matching = useMemo(() => {
    if (!ownerId || !typeId || !calibreId) return []
    return stockRows
      .filter(
        (r) =>
          r.bucket === 'available' &&
          r.isOldStock &&
          r.ownerId === ownerId &&
          r.typeId === typeId &&
          r.calibreId === calibreId &&
          r.barcode2 !== null,
      )
      .sort((a, b) => (a.barcode2 ?? '').localeCompare(b.barcode2 ?? ''))
  }, [stockRows, ownerId, typeId, calibreId])

  const bookKg = matching.filter((p) => picked.has(p.barcode2!)).reduce((sum, p) => sum + p.qtyKg, 0)
  const weighedNum = parseFloat(weighedKg)
  const hasWeighed = weighedNum > 0
  // Storage loss, shown live so the figure is understood at entry time
  // rather than only surfacing later in a report. Informational, never
  // blocking — a positive OR negative gap is legitimate, book weights are
  // approximations in both directions.
  const storageDeltaKg = hasWeighed ? weighedNum - bookKg : null

  function resetPicks(patch: { ownerId?: string; typeId?: string; calibreId?: string }) {
    setPicked(new Set())
    setWeighedKg('')
    if (patch.ownerId !== undefined) setOwnerId(patch.ownerId)
    if (patch.typeId !== undefined) setTypeId(patch.typeId)
    if (patch.calibreId !== undefined) setCalibreId(patch.calibreId)
  }

  function togglePallet(barcode2: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(barcode2)) next.delete(barcode2)
      else next.add(barcode2)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (picked.size === 0) {
      setError('Kamida bitta pallet tanlang.')
      return
    }
    if (!hasWeighed) {
      setError("Tarozidagi og'irlikni kiriting.")
      return
    }
    setSubmitting(true)
    try {
      // One combined submit: the RPC consumes the pallets, mints the serial,
      // opens its wash cycle, records the send and writes the origin note —
      // all in one transaction, so a failure can never strand consumed
      // pallets with no send behind them.
      const { error: rpcErr } = await supabase.rpc('send_old_stock_to_moyka', {
        p_owner_id: ownerId,
        p_type_id: typeId,
        p_pallet_barcodes: [...picked],
        p_weighed_kg: weighedNum,
      })
      if (rpcErr) throw rpcErr
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectClass =
    'w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

  return (
    <Card tone="pending">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">
            Eski zaxirani qayta yuvishga yuborish
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
            Eski zaxira
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            required
            value={ownerId}
            onChange={(e) => resetPicks({ ownerId: e.target.value })}
            className={selectClass}
            aria-label="Buyurtmachi"
          >
            <option value="" disabled>
              Buyurtmachi…
            </option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            required
            value={typeId}
            onChange={(e) => resetPicks({ typeId: e.target.value })}
            className={selectClass}
            aria-label="Mahsulot turi"
          >
            <option value="" disabled>
              Tur…
            </option>
            {productTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            required
            value={calibreId}
            onChange={(e) => resetPicks({ calibreId: e.target.value })}
            className={selectClass}
            aria-label="Kalibr"
          >
            <option value="" disabled>
              Kalibr…
            </option>
            {calibres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {ownerId && typeId && calibreId && (
          <div className="border-t border-amber-200 pt-2 dark:border-amber-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Palletlarni tanlang — ular ishlatilgan deb belgilanadi va yangi seriya ochiladi. Yorliq chop
              etilmaydi: palletlar jo'natilmaydi, qayta ishlanadi.
            </p>
            {stockLoading ? (
              <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>
            ) : matching.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">
                Bu buyurtmachida ushbu tur/kalibrda mavjud eski pallet yo'q.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {matching.map((p) => {
                  const selected = picked.has(p.barcode2!)
                  return (
                    <button
                      key={p.rowKey}
                      type="button"
                      onClick={() => togglePallet(p.barcode2!)}
                      className={`rounded-md border px-2 py-1 text-left text-xs ${
                        selected
                          ? 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-mono">
                        {selected ? '✓ ' : ''}
                        {p.barcode2}
                      </span>
                      {/* '~' marks the book weight as an estimate, the same
                          marker the qoldig'i table uses. */}
                      <span className="ml-1.5">~{Math.round(p.qtyKg).toLocaleString()} kg</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {picked.size > 0 && (
          <div className="space-y-2 border-t border-amber-200 pt-2 dark:border-amber-900">
            {/* Reference only — deliberately rendered as plain text, not an
                input, so it can never be mistaken for the figure being
                recorded. */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                Kitob bo'yicha ({picked.size} ta pallet)
              </span>
              <span className="font-medium text-slate-600 dark:text-slate-300">
                ~{Math.round(bookKg).toLocaleString()} kg
              </span>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="old-stock-weighed"
              >
                Tarozidagi og'irlik <span className="font-normal text-slate-400">(majburiy)</span>
              </label>
              <div className="mt-1">
                <TextInput
                  id="old-stock-weighed"
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
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Kitob og'irligi taxminiy — haqiqiy tarozi ko'rsatkichini kiriting.
              </p>
            </div>

            {storageDeltaKg !== null && (
              <StatusNote tone="neutral">
                Saqlash farqi: {storageDeltaKg >= 0 ? '+' : ''}
                {Math.round(storageDeltaKg).toLocaleString()} kg — bu saqlash yo'qotishi, yuvish
                yo'qotishiga qo'shilmaydi.
              </StatusNote>
            )}
          </div>
        )}

        {error && <StatusNote tone="problem">{error}</StatusNote>}

        <div className="space-y-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitting || picked.size === 0 || !hasWeighed}
          >
            {submitting ? 'Yuborilmoqda…' : 'Moykaga yuborish'}
          </Button>
          <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
            Bekor qilish
          </Button>
        </div>
      </form>
    </Card>
  )
}
