import { useMemo, useState } from 'react'
import type { RezkaKnAvailabilityRow } from '../../lib/useRezkaKnAvailability'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { RezkaBadge } from '../../components/ui/RezkaBadge'

// Internal KN goes to Rezka in boxes of at least ~10 kg. Below that the form
// WARNS and still allows it -- warnings never block (SPEC.md §5.R).
export const ICHKI_MIN_SOFT_KG = 10

// "Ichkaridan olish" (SPEC.md §5.R, Rezka Prompt 2): draw Konditerka from
// finished stock by kg. Owner -> type -> the pair's available KN (from
// rezka_kn_available, the same predicate send_kn_to_rezka allocates from)
// -> kg -> confirm. One owner and one type per draw by construction. The
// RPC's "yetishmayapti" (not enough) comes back as this form's own inline
// error, never a toast.
export function IchkiToRezkaForm({
  rows,
  ownerName,
  typeName,
  onCancel,
  onSubmit,
}: {
  rows: RezkaKnAvailabilityRow[]
  ownerName: (id: string) => string
  typeName: (id: string) => string
  onCancel: () => void
  onSubmit: (ownerId: string, typeId: string, kg: number) => Promise<string>
}) {
  const [ownerId, setOwnerId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [kg, setKg] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ serial: string; kg: number } | null>(null)

  const ownerIds = useMemo(() => [...new Set(rows.map((r) => r.owner_id))], [rows])
  const typeRows = rows.filter((r) => r.owner_id === ownerId)
  const pair = rows.find((r) => r.owner_id === ownerId && r.type_id === typeId) ?? null
  const kgNum = parseFloat(kg)
  const hasKg = kgNum > 0

  async function handleSubmit() {
    if (!pair) return
    setError(null)
    if (!hasKg) {
      setError("Og'irlikni kiriting.")
      return
    }
    setSubmitting(true)
    try {
      const serial = await onSubmit(pair.owner_id, pair.type_id, kgNum)
      setResult({ serial, kg: kgNum })
      setKg('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectClass =
    'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

  return (
    <Card tone="pending">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">Ichkaridan olish</span>
        <RezkaBadge provenance="ichki" />
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Rezkaga olinadigan Konditerka yo'q.</p>
      ) : (
        <div className="mt-2 space-y-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="ichki-owner">
              Egasi
            </label>
            <select
              id="ichki-owner"
              className={selectClass}
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value)
                setTypeId('')
                setResult(null)
                setError(null)
              }}
            >
              <option value="">Tanlang</option>
              {ownerIds.map((id) => (
                <option key={id} value={id}>
                  {ownerName(id)}
                </option>
              ))}
            </select>
          </div>

          {ownerId && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="ichki-type">
                Tur
              </label>
              <select
                id="ichki-type"
                className={selectClass}
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value)
                  setResult(null)
                  setError(null)
                }}
              >
                <option value="">Tanlang</option>
                {typeRows.map((r) => (
                  <option key={r.type_id} value={r.type_id}>
                    {typeName(r.type_id)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {pair && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Mavjud Konditerka</span>
                <span className="font-medium text-slate-600 dark:text-slate-300">{Math.round(pair.available_kg).toLocaleString()} kg</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="ichki-kg">
                  Og'irlik (kg) <span className="font-normal text-slate-400">(majburiy)</span>
                </label>
                <div className="mt-1">
                  <TextInput
                    id="ichki-kg"
                    type="number"
                    min="0"
                    step="0.1"
                    required
                    placeholder="Qancha kg"
                    value={kg}
                    onChange={(e) => setKg(e.target.value)}
                    className="!text-2xl font-bold"
                  />
                </div>
              </div>
              {hasKg && kgNum < ICHKI_MIN_SOFT_KG && (
                <StatusNote tone="pending">
                  Odatda {ICHKI_MIN_SOFT_KG} kg dan kam olinmaydi. Baribir yuborish mumkin.
                </StatusNote>
              )}
            </>
          )}

          {result && (
            <StatusNote tone="ok">
              Seriya {result.serial}: {result.kg.toLocaleString()} kg Rezkaga yuborildi.
            </StatusNote>
          )}
          {error && <StatusNote tone="problem">{error}</StatusNote>}

          <div className="space-y-2">
            <Button type="button" variant="primary" size="lg" fullWidth disabled={submitting || !pair || !hasKg} onClick={handleSubmit}>
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
