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
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
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
  // Raw dispatch pool rework (2026-08-01, see DECISIONS.md "Raw dispatch
  // serial pool"): a row is either a finished-calibre line or a raw line
  // pointing at a POOL of candidate serials — mirrors the DB's own
  // line_kind discriminator. Washing-path raw only — a KN load bound for
  // cutting is out of scope, see the Rezka inspection report.
  kind: 'finished' | 'raw'
  typeId: string
  calibreId: string
  // Optional for a raw row (requirement 3) — Menejer may not know how much
  // will actually be drawn; Ombor decides that on the floor. Still required
  // and picker-derived for a finished row, unchanged.
  qty: string
  // §3.1/§5.4 Option B (2026-07-26) — the picker is no longer a calculator
  // only: these barcodes ARE what gets persisted to chiqim_line_pallets on
  // submit, reserving them for this request until it completes or is
  // voided. Reset whenever it would otherwise go stale (type/calibre/owner
  // changed) — see the picker's own comment for why. Finished rows only.
  selectedBarcodes: Set<string>
  // Raw dispatch pool — every serial Menejer names as a SOURCE for this
  // line, persisted to chiqim_line_raw_serials on submit (mirrors
  // selectedBarcodes' own "row = named sources" shape). Unlike
  // selectedBarcodes this has no relationship to qty — "these are your
  // sources," not an allocation (requirement statement).
  rawSerialPool: Set<string>
}

function newRow(): LineRow {
  return { key: crypto.randomUUID(), kind: 'finished', typeId: '', calibreId: '', qty: '', selectedBarcodes: new Set(), rawSerialPool: new Set() }
}

interface SavedLine {
  key: string
  kind: 'finished' | 'raw'
  typeId: string
  calibreId: string
  rawSerialPool: string[]
  qtyKg: number | null
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
  // Raw dispatch (2026-07-31) — the SAME hook the Moyka send screen reads,
  // per the "build once" decision (see DECISIONS.md "Raw dispatch"): this
  // picker and Ombor's send window can never disagree about what raw
  // balance a serial has left.
  const { serials: rawSerials } = useMoykaSerials()

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
    if (row.kind !== 'finished' || !ownerId || !row.typeId || !row.calibreId) return []
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

  // Raw dispatch pool (2026-08-01) — this client's own raw serials with a
  // positive balance, matching this row's type: the candidate POOL, not a
  // single pick. Sorted oldest-first (requirement 5, "aged raw moves before
  // fresh") — deliberately the OPPOSITE of useMoykaSerials' own newest-first
  // default, which stays as-is (load-bearing for §5.2 Window 1 elsewhere);
  // this is a local sort of the same data for this picker only.
  function matchingRawSerials(row: LineRow): MoykaSerial[] {
    if (row.kind !== 'raw' || !ownerId || !row.typeId) return []
    return rawSerials
      .filter((s) => s.owner_id === ownerId && s.type_id === row.typeId && s.available > 0)
      .sort((a, b) => a.order_date.localeCompare(b.order_date))
  }

  // Toggling a raw serial adds/removes it from this row's pool — a named
  // list of SOURCES, not an allocation (the task's own framing): unlike
  // togglePallet, this never touches qty. The pool's total available has
  // no relationship to what Menejer eventually types (if anything) — Ombor
  // decides how much comes from each serial on the floor.
  function toggleRawSerial(row: LineRow, serial: MoykaSerial) {
    const next = new Set(row.rawSerialPool)
    if (next.has(serial.serial)) next.delete(serial.serial)
    else next.add(serial.serial)
    updateRow(row.key, { rawSerialPool: next })
  }

  function feasibilityHint(row: LineRow): string | null {
    const target = parseFloat(row.qty)
    if (row.kind !== 'finished' || !row.typeId || !row.calibreId || !(target > 0)) return null

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

    const validRows = rows.filter((r) =>
      r.kind === 'finished' ? r.typeId && r.calibreId && parseFloat(r.qty) > 0 : r.typeId && r.rawSerialPool.size > 0,
    )
    if (!ownerId || !plate || !driver || validRows.length === 0) {
      setError('Barcha maydonlarni to\'ldiring va kamida bitta tur/kalibr yoki xom qatorini kiriting.')
      return
    }
    // App-level guard (2026-08-01 feedback): the DB can't enforce "a raw
    // line has at least one pooled serial" across two tables, so a raw row
    // with a type chosen but zero serials picked must be caught HERE,
    // explicitly — not just silently dropped by the validRows filter above,
    // which would let it vanish unremarked if another row on the same form
    // happened to be valid (validRows.length === 0 alone wouldn't catch it).
    const emptyPoolRawRows = rows.filter((r) => r.kind === 'raw' && r.typeId && r.rawSerialPool.size === 0)
    if (emptyPoolRawRows.length > 0) {
      setError("Bir yoki bir nechta xom qatorida manba seriya tanlanmagan — kamida bitta seriya tanlang yoki qatorni o'chiring.")
      return
    }
    // §5.4 Option B (requirement 5, "no special-casing"): a row with real
    // matching stock MUST have picked pallets — the qty field is read-only
    // in that case (see the TextInput above), so reaching this with zero
    // selections only happens if stock existed when typed then vanished
    // (another request claimed it) before submit. The zero-pallets
    // fallback row (matches.length === 0 the whole time) is exempt, same
    // as before this pass. Raw rows never reach this check — a raw row's
    // "pick" is its rawSerialPool, already required by validRows and the
    // empty-pool guard above.
    const missingPicks = validRows.filter(
      (r) => r.kind === 'finished' && matchingPallets(r).length > 0 && r.selectedBarcodes.size === 0,
    )
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
          .insert({
            request_id: request.id,
            type_id: r.typeId,
            calibre_id: r.kind === 'finished' ? r.calibreId : null,
            line_kind: r.kind,
            qty_kg: r.qty ? parseFloat(r.qty) : null,
          })
          .select('id')
          .single()
        if (lineErr) throw lineErr
        lineIdByRowKey.set(r.key, line.id)
      }

      const reservations = validRows
        .filter((r) => r.kind === 'finished')
        .flatMap((r) => {
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

      // Raw dispatch pool — symmetric with the reservations insert above:
      // each raw row's chosen sources are batch-inserted into the new
      // junction table. No 23505 race handling needed here (unlike
      // pallets): line_id is freshly minted this request, so a collision
      // within one submission is impossible.
      const rawPoolRows = validRows
        .filter((r) => r.kind === 'raw')
        .flatMap((r) => {
          const lineId = lineIdByRowKey.get(r.key)!
          return [...r.rawSerialPool].map((serial) => ({ line_id: lineId, serial }))
        })
      if (rawPoolRows.length > 0) {
        const { error: poolErr } = await supabase.from('chiqim_line_raw_serials').insert(rawPoolRows)
        if (poolErr) throw poolErr
      }

      setSavedLines(
        validRows.map((r) => ({
          key: r.key,
          kind: r.kind,
          typeId: r.typeId,
          calibreId: r.calibreId,
          rawSerialPool: [...r.rawSerialPool],
          qtyKg: r.qty ? parseFloat(r.qty) : null,
        })),
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
              // selection (it was scoped to the PREVIOUS client's stock) —
              // both the pallet picker and the raw-serial pool.
              setRows((r) => r.map((row) => ({ ...row, selectedBarcodes: new Set(), rawSerialPool: new Set() })))
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
          const rawMatches = matchingRawSerials(row)
          const pickerActive =
            row.kind === 'finished' ? !!ownerId && !!row.typeId && !!row.calibreId : !!ownerId && !!row.typeId
          return (
            <Card key={row.key} padding="compact">
              {/* Raw dispatch (2026-07-31) — a row is either a finished-
                  calibre line or a raw line pinned to one raw serial (§ see
                  LineRow's own comment). Switching kind clears whatever the
                  other kind had picked, same "stale selection" reasoning the
                  owner/type/calibre onChange handlers already use below. */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => updateRow(row.key, { kind: 'finished', rawSerialPool: new Set(), qty: '' })}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    row.kind === 'finished'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  Kalibrlangan
                </button>
                <button
                  type="button"
                  onClick={() => updateRow(row.key, { kind: 'raw', calibreId: '', selectedBarcodes: new Set(), qty: '' })}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    row.kind === 'raw'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  Xom
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <select
                  required
                  value={row.typeId}
                  onChange={(e) =>
                    updateRow(row.key, { typeId: e.target.value, selectedBarcodes: new Set(), rawSerialPool: new Set(), qty: '' })
                  }
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
                {row.kind === 'finished' && (
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
                )}
                <TextInput
                  type="number"
                  min="0"
                  step="0.1"
                  required={row.kind === 'finished'}
                  placeholder={row.kind === 'raw' ? 'Taxminiy miqdor (ixtiyoriy)' : 'Miqdori (kg)'}
                  value={row.qty}
                  // §5.4 Option B: once real pallets exist for this
                  // type+calibre, qty is derived ONLY from togglePallet's
                  // selection sum — typing directly would let a number
                  // through with no pallets backing it, breaking "every
                  // line has named pallets" (requirement 5). Manual typing
                  // stays live only for the pre-existing zero-pallets
                  // fallback (matchingPallets(row).length === 0). Raw rows
                  // are never read-only and never required (2026-08-01,
                  // requirement 3) — the pool's total available has no
                  // relationship to this figure; if entered at all, it's
                  // Menejer's own rough estimate, not a target Ombor must
                  // hit.
                  readOnly={row.kind === 'finished' && matchingPallets(row).length > 0}
                  onChange={(e) => updateRow(row.key, { qty: e.target.value, selectedBarcodes: new Set() })}
                  className="w-40"
                />
                {rows.length > 1 && (
                  <IconButton label="Qatorni o'chirish" tone="danger" onClick={() => removeRow(row.key)}>
                    ✕
                  </IconButton>
                )}
              </div>

              {pickerActive && row.kind === 'raw' && (
                <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <p className="text-xs text-slate-400">
                    Manba seriyalarni tanlang (bir nechtasi mumkin) — bu ro'yxat Ombor uchun manbalar, taqsimot
                    emas. Ombor har biridan qancha olishini yuklash paytida o'zi kiritadi.
                  </p>
                  {rawMatches.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">Bu buyurtmachida ushbu turda mavjud xom seriya yo'q.</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {rawMatches.map((s) => {
                        const selected = row.rawSerialPool.has(s.serial)
                        return (
                          <button
                            key={s.serial}
                            type="button"
                            onClick={() => toggleRawSerial(row, s)}
                            className={`rounded-md border px-2 py-1 text-left text-xs ${
                              selected
                                ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span className="font-mono">{selected ? '✓ ' : ''}{s.serial}</span>
                            <span className="ml-1.5">{Math.round(s.available).toLocaleString()} kg mavjud</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {pickerActive && row.kind === 'finished' && (
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
            {jamiAvto.toLocaleString()} kg ·{' '}
            {rows.filter((r) => r.typeId && (r.kind === 'finished' ? r.calibreId : r.rawSerialPool.size > 0)).length} qator
          </span>
        </div>
      </Card>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {savedLines && (
        <Card>
          {savedLines.map((line) => (
            <div key={line.key} className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                {typeName(line.typeId)} ·{' '}
                {line.kind === 'finished' ? calibreLabel(line.calibreId) : `Xom · ${line.rawSerialPool.join(', ')}`}
              </span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {line.qtyKg === null ? '—' : `${line.qtyKg.toLocaleString()} kg`}
              </span>
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
