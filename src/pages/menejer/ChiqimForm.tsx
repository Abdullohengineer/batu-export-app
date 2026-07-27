import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useAuth } from '../../lib/AuthProvider'
import { useAvailableFinishedStock } from '../../lib/useAvailableFinishedStock'
import { checkFeasibility } from '../../lib/chiqimFeasibility'
import { useStockOnHand } from '../../lib/useStockOnHand'
import { useReservedPalletBarcodes } from '../../lib/useReservedPalletBarcodes'
import type { StockOnHandRow } from '../../lib/stockOnHand'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { toneStyles } from '../../components/ui/tokens'

interface LineRow {
  key: string
  typeId: string
  calibreId: string
  qty: string
  // §3.1/§5.4 Option B (2026-07-26) — the picker is no longer a calculator
  // only: these barcodes ARE what gets persisted to chiqim_line_pallets on
  // submit, reserving them for this request until it completes or is
  // voided. Reset whenever it would otherwise go stale (type/calibre/owner
  // changed) — see the picker's own comment for why.
  selectedBarcodes: Set<string>
}

function newRow(): LineRow {
  return { key: crypto.randomUUID(), typeId: '', calibreId: '', qty: '', selectedBarcodes: new Set() }
}

interface SavedLine {
  key: string
  typeId: string
  calibreId: string
  qtyKg: number
}

// §3.1 CHIQIM form: Sana · Moshina · Haydovchi · Buyurtmachi · repeatable
// Tur + Kalibr + Miqdori rows (calibre set incl. Konditirskiy) · Jami avto.
// 🔒 No serial, no doc photo (unlike KIRIM) — see §3.1.
//
// §3.1/§5.4 Option B (2026-07-26): requests now target SPECIFIC pallets,
// not just a calibre + kg amount — the picker's selections are persisted to
// chiqim_line_pallets on submit (see handleSubmit), reserving them until
// Ombor finishes loading or the request is voided. Manual qty-typing stays
// available only when zero matching pallets exist at all (nothing to
// reserve in that case, same as before this pass) — see the qty field's
// own disabled condition below.
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
  // §3.1 inline picker — reuses stock_on_hand_rows (via the same hook
  // §3.2.6 already built), not a parallel query. Deliberately a SEPARATE
  // source from `pallets` above: that one feeds only the existing
  // feasibility soft-warning and is not scoped to this request's own
  // client (a pre-existing characteristic, left unchanged per the task);
  // the picker needs real per-client pallets, which stock_on_hand_rows
  // already carries via owner_id.
  const { rows: stockRows } = useStockOnHand()
  // Option B: excludes pallets another open request already reserved —
  // same shared hook useAvailableFinishedStock.ts uses, so the picker and
  // the feasibility hint can never disagree about what's really available.
  const { reserved: reservedBarcodes } = useReservedPalletBarcodes()

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

  // Available, this client's own stock, matching this line's type+calibre —
  // the exact set the picker shows and the only pallets a click can toggle.
  // Excludes anything another open request already reserved (Option B) —
  // a reserved pallet must never be double-offered here.
  function matchingPallets(row: LineRow): StockOnHandRow[] {
    if (!ownerId || !row.typeId || !row.calibreId) return []
    return stockRows.filter(
      (r) =>
        r.bucket === 'available' &&
        r.ownerId === ownerId &&
        r.typeId === row.typeId &&
        r.calibreId === row.calibreId &&
        !(r.barcode2 && reservedBarcodes.has(r.barcode2)),
    )
  }

  // Clicking a pallet toggles it and recomputes qty as the sum of whatever's
  // now selected — a calculator action, not a reservation (nothing here
  // writes to any table; chiqim_lines still gets only the resulting number).
  function togglePallet(row: LineRow, pallet: StockOnHandRow) {
    if (!pallet.barcode2) return
    const next = new Set(row.selectedBarcodes)
    if (next.has(pallet.barcode2)) next.delete(pallet.barcode2)
    else next.add(pallet.barcode2)
    const sumKg = matchingPallets(row)
      .filter((p) => p.barcode2 && next.has(p.barcode2))
      .reduce((sum, p) => sum + p.qtyKg, 0)
    updateRow(row.key, { selectedBarcodes: next, qty: String(Math.round(sumKg * 100) / 100) })
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
    // §5.4 Option B (requirement 5, "no special-casing"): a row with real
    // matching stock MUST have picked pallets — the qty field is read-only
    // in that case (see the TextInput above), so reaching this with zero
    // selections only happens if stock existed when typed then vanished
    // (another request claimed it) before submit. The zero-pallets
    // fallback row (matches.length === 0 the whole time) is exempt, same
    // as before this pass.
    const missingPicks = validRows.filter((r) => matchingPallets(r).length > 0 && r.selectedBarcodes.size === 0)
    if (missingPicks.length > 0) {
      setError('Bir yoki bir nechta qatorda pallet tanlanmagan — palletlarni tanlang yoki qatorni yangilang.')
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

      // Sequential, not a single batch insert: each row's own returned id
      // is what correctly ties its own selectedBarcodes to the right line
      // in chiqim_line_pallets below — relying on batch-insert RETURNING
      // order to match input order isn't a guarantee worth trusting for a
      // mapping this load-bearing (a mismatch would silently reserve
      // pallets under the wrong line).
      const lineIdByRowKey = new Map<string, string>()
      for (const r of validRows) {
        const { data: line, error: lineErr } = await supabase
          .from('chiqim_lines')
          .insert({ request_id: request.id, type_id: r.typeId, calibre_id: r.calibreId, qty_kg: parseFloat(r.qty) })
          .select('id')
          .single()
        if (lineErr) throw lineErr
        lineIdByRowKey.set(r.key, line.id)
      }

      const reservations = validRows.flatMap((r) => {
        const lineId = lineIdByRowKey.get(r.key)!
        return [...r.selectedBarcodes].map((barcode2) => ({ line_id: lineId, barcode2 }))
      })
      if (reservations.length > 0) {
        const { error: reserveErr } = await supabase.from('chiqim_line_pallets').insert(reservations)
        if (reserveErr) {
          // 23505 = the active-reservation unique index (0033) — another
          // request reserved the same pallet in the moment between this
          // form loading the picker and submit. Same race class and same
          // friendly-message treatment as handleFinish's own
          // dispatch_manifest 23505 handling (OmborChiqimTab.tsx).
          throw new Error(
            reserveErr.code === '23505'
              ? 'Tanlangan palletlardan biri shu orada boshqa so\'rov uchun band qilindi — sahifani yangilab qayta urinib ko\'ring.'
              : reserveErr.message,
          )
        }
      }

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
      {/* Text stays "Yangi CHIQIM" -- e2e asserts getByRole('heading',
          {name:'Yangi CHIQIM'}). Only the tone changed. */}
      <SectionHeading tone="info">Yangi CHIQIM</SectionHeading>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Sana">
          <TextInput type="date" required value={sana} onChange={(e) => setSana(e.target.value)} />
        </FormField>
        {/* Not FormField for this field or the next: same direct-child
            locator constraint as KirimForm's "Moshina raqami"/"Haydovchi
            ismi" fields -- see that file's comment. */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Moshina raqami</label>
          <TextInput type="text" required value={plate} onChange={(e) => setPlate(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Haydovchi ismi</label>
          <TextInput type="text" required value={driver} onChange={(e) => setDriver(e.target.value)} className="mt-1" />
        </div>
        <FormField label="Buyurtmachi">
          <select
            required
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value)
              // A different client invalidates every row's own picker
              // selection (it was scoped to the PREVIOUS client's stock).
              setRows((r) => r.map((row) => ({ ...row, selectedBarcodes: new Set() })))
            }}
            className="w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
        </FormField>
      </div>

      <div className="space-y-2">
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Tur va kalibr bo'yicha — kerakcha qator qo'shing
        </span>

        {rows.map((row) => {
          const hint = feasibilityHint(row)
          const matches = matchingPallets(row)
          const pickerActive = !!ownerId && !!row.typeId && !!row.calibreId
          return (
            <Card key={row.key} padding="compact">
              <div className="flex items-center gap-2">
                <select
                  required
                  value={row.typeId}
                  onChange={(e) => updateRow(row.key, { typeId: e.target.value, selectedBarcodes: new Set() })}
                  className="flex-1 rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                  onChange={(e) => updateRow(row.key, { calibreId: e.target.value, selectedBarcodes: new Set() })}
                  className="flex-1 rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                <TextInput
                  type="number"
                  min="0"
                  step="0.1"
                  required
                  placeholder="Miqdori (kg)"
                  value={row.qty}
                  // §5.4 Option B: once real pallets exist for this
                  // type+calibre, qty is derived ONLY from togglePallet's
                  // selection sum — typing directly would let a number
                  // through with no pallets backing it, breaking "every
                  // line has named pallets" (requirement 5). Manual typing
                  // stays live only for the pre-existing zero-pallets
                  // fallback (matchingPallets(row).length === 0).
                  readOnly={matchingPallets(row).length > 0}
                  onChange={(e) => updateRow(row.key, { qty: e.target.value, selectedBarcodes: new Set() })}
                  className="w-40"
                />
                {rows.length > 1 && (
                  <IconButton label="Qatorni o'chirish" tone="danger" onClick={() => removeRow(row.key)}>
                    ✕
                  </IconButton>
                )}
              </div>

              {pickerActive && (
                <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <p className="text-xs text-slate-400">
                    Palletlarni tanlang — ular ushbu so'rov uchun band qilinadi va Omborga qaysi palletlarni
                    yig'ish kerakligi ko'rsatiladi.
                  </p>
                  {matches.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">Bu buyurtmachida ushbu tur/kalibrda mavjud pallet yo'q.</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {matches.map((p) => {
                        const selected = !!p.barcode2 && row.selectedBarcodes.has(p.barcode2)
                        return (
                          <button
                            key={p.rowKey}
                            type="button"
                            onClick={() => togglePallet(row, p)}
                            className={`rounded-md border px-2 py-1 text-left text-xs ${
                              selected
                                ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="font-mono">{selected ? '✓ ' : ''}{p.barcode2}</span>
                            <span className="ml-1.5">{Math.round(p.qtyKg).toLocaleString()} kg</span>
                            <span className="ml-1.5">{p.moisturePct === null ? '—' : `${p.moisturePct}%`}</span>
                            <span className="ml-1.5 text-slate-500 dark:text-slate-400">{p.daysHeld} kun</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {hint && (
                <div className="mt-1">
                  <StatusNote tone="pending">{hint}</StatusNote>
                </div>
              )}
            </Card>
          )
        })}

        <Button
          type="button"
          variant="ghost"
          size="md"
          fullWidth
          onClick={addRow}
          className="border border-dashed !border-blue-300 !text-blue-700 hover:bg-blue-50 dark:!border-blue-800 dark:!text-blue-400 dark:hover:bg-blue-950/30"
        >
          + Tur/kalibr qo'shish
        </Button>
      </div>

      <Card tone="info">
        <div className="flex items-center justify-between text-sm">
          <span className={`font-medium ${toneStyles.info.text}`}>Jami (avto)</span>
          <span className={`font-semibold ${toneStyles.info.text}`}>
            {jamiAvto.toLocaleString()} kg · {rows.filter((r) => r.typeId && r.calibreId).length} qator
          </span>
        </div>
      </Card>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {savedLines && (
        <Card>
          {savedLines.map((line) => (
            <div key={line.key} className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                {typeName(line.typeId)} · {calibreLabel(line.calibreId)}
              </span>
              <span className="font-mono text-slate-900 dark:text-slate-100">{line.qtyKg.toLocaleString()} kg</span>
            </div>
          ))}
        </Card>
      )}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
        {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
      </Button>
    </form>
  )
}
