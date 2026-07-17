import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useAuth } from '../../lib/AuthProvider'
import { useAvailableFinishedStock } from '../../lib/useAvailableFinishedStock'
import { checkFeasibility } from '../../lib/chiqimFeasibility'

interface LineRow {
  key: string
  typeId: string
  calibreId: string
  qty: string
}

function newRow(): LineRow {
  return { key: crypto.randomUUID(), typeId: '', calibreId: '', qty: '' }
}

interface SavedLine {
  key: string
  typeId: string
  calibreId: string
  qtyKg: number
}

// §3.1 CHIQIM form: Sana · Moshina · Haydovchi · Buyurtmachi · repeatable
// Tur + Kalibr + Miqdori rows (calibre set incl. Konditirskiy) · Jami avto.
// 🔒 No serial, no doc photo (unlike KIRIM) — see §3.1. Requests target a
// calibre + kg amount, never specific pallets/serials — pallet selection is
// Ombor's job at §5.4 (a later prompt), so this form never writes to
// finished_pallets or dispatch_manifest.
//
// 🔒 Whole-pallet soft warning (§3.1, already locked): checks each row's
// target against available whole pallets for that type+calibre and
// suggests the nearest achievable totals if it doesn't map cleanly — never
// blocks, matching every other soft-warning in the app (Kam chiqdi,
// Tugallash's remainder/loss warnings). This is a suggestion for the
// manager to confirm with the client before the truck is sent, not a
// data-integrity gate.
export function ChiqimForm({ onSaved }: { onSaved: () => void }) {
  const { profile } = useAuth()
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { pallets } = useAvailableFinishedStock()

  const [sana, setSana] = useState(() => new Date().toISOString().slice(0, 10))
  const [plate, setPlate] = useState('')
  const [driver, setDriver] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [rows, setRows] = useState<LineRow[]>([newRow()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedLines, setSavedLines] = useState<SavedLine[] | null>(null)

  const jamiAvto = rows.reduce((sum, r) => sum + (parseFloat(r.qty) || 0), 0)

  function addRow() {
    setRows((r) => [...r, newRow()])
  }

  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r))
  }

  function updateRow(key: string, patch: Partial<LineRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function feasibilityHint(row: LineRow): string | null {
    const target = parseFloat(row.qty)
    if (!row.typeId || !row.calibreId || !(target > 0)) return null

    const weights = pallets
      .filter((p) => p.type_id === row.typeId && p.calibre_id === row.calibreId)
      .map((p) => p.weight_kg)
    const result = checkFeasibility(weights, target)
    if (result.achievable) return null // clean match — nothing to flag

    const below = result.nearestBelow === null ? null : `${result.nearestBelow.toLocaleString()} kg`
    const above = result.nearestAbove === null ? null : `${result.nearestAbove.toLocaleString()} kg`
    if (below && above) return `Butun palletlar bilan aniq mos kelmaydi — eng yaqin: ${below} yoki ${above}`
    if (above) return `Omborda yetarli emas — eng yaqin yetarli miqdor: ${above}`
    if (below) return `Butun palletlar bilan aniq mos kelmaydi — omborda mavjud eng ko'p: ${below}`
    return `Bu tur/kalibr uchun omborda pallet yo'q`
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const validRows = rows.filter((r) => r.typeId && r.calibreId && parseFloat(r.qty) > 0)
    if (!ownerId || !plate || !driver || validRows.length === 0) {
      setError('Barcha maydonlarni to\'ldiring va kamida bitta tur/kalibr qatorini kiriting.')
      return
    }

    setSubmitting(true)
    try {
      const { data: request, error: reqErr } = await supabase
        .from('chiqim_requests')
        .insert({
          request_date: sana,
          plate,
          driver,
          owner_id: ownerId,
          created_by: profile?.id,
        })
        .select('id')
        .single()
      if (reqErr) throw reqErr

      const { error: linesErr } = await supabase.from('chiqim_lines').insert(
        validRows.map((r) => ({
          request_id: request.id,
          type_id: r.typeId,
          calibre_id: r.calibreId,
          qty_kg: parseFloat(r.qty),
        })),
      )
      if (linesErr) throw linesErr

      setSavedLines(
        validRows.map((r) => ({ key: r.key, typeId: r.typeId, calibreId: r.calibreId, qtyKg: parseFloat(r.qty) })),
      )
      setPlate('')
      setDriver('')
      setOwnerId('')
      setRows([newRow()])
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
      setSavedLines(null)
    } finally {
      setSubmitting(false)
    }
  }

  function typeName(typeId: string) {
    return productTypes.find((t) => t.id === typeId)?.name ?? typeId
  }
  function calibreLabel(calibreId: string) {
    return calibres.find((c) => c.id === calibreId)?.label ?? calibreId
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yangi CHIQIM</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Sana</label>
          <input
            type="date"
            required
            value={sana}
            onChange={(e) => setSana(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Moshina raqami</label>
          <input
            type="text"
            required
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Haydovchi ismi</label>
          <input
            type="text"
            required
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Buyurtmachi</label>
          <select
            required
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="" disabled>
              Tanlang…
            </option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tur + Kalibr + Miqdori</span>
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-medium text-slate-700 underline dark:text-slate-300"
          >
            + Tur qo'shish
          </button>
        </div>

        {rows.map((row) => {
          const hint = feasibilityHint(row)
          return (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center gap-2">
                <select
                  required
                  value={row.typeId}
                  onChange={(e) => updateRow(row.key, { typeId: e.target.value })}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                  value={row.calibreId}
                  onChange={(e) => updateRow(row.key, { calibreId: e.target.value })}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  required
                  placeholder="Miqdori (kg)"
                  value={row.qty}
                  onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                  className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label="Qatorni o'chirish"
                    className="rounded-md px-2 py-2 text-sm text-slate-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                )}
              </div>
              {hint && (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400" role="status">
                  {hint}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
        <span className="font-medium text-slate-700 dark:text-slate-300">Jami avto</span>
        <span className="font-semibold text-slate-900 dark:text-slate-100">{jamiAvto.toLocaleString()} kg</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {savedLines && (
        <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
          {savedLines.map((line) => (
            <div key={line.key} className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">
                {typeName(line.typeId)} · {calibreLabel(line.calibreId)}
              </span>
              <span className="font-mono text-slate-900 dark:text-slate-100">{line.qtyKg.toLocaleString()} kg</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  )
}
