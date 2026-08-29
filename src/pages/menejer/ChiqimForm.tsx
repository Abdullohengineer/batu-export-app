import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useAuth } from '../../lib/AuthProvider'
import { useFinishedCalibreAvailability } from '../../lib/useAvailableFinishedStock'
import { useStockOnHand } from '../../lib/useStockOnHand'
import { useMoykaSerials, type MoykaSerial } from '../../lib/useMoykaSerials'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { toneStyles } from '../../components/ui/tokens'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

// Opening stock, Stage 2 (2026-08-02, see DECISIONS.md "Opening stock"):
// line_kind widened from finished|raw to five values. old_kn has no
// precedent -- a weight pool with no pallets and no serial, Ombor resolves
// which pool at collection time the same way an out-of-pool raw draw
// resolves its serial (no Menejer-side pool-of-candidates to pick from,
// there's exactly one pool per type per owner).
type LineKind = 'finished' | 'raw' | 'old_washed' | 'old_kn' | 'old_raw'

interface LineRow {
  key: string
  kind: LineKind
  typeId: string
  calibreId: string
  // Declared net kg -- always Menejer's own number now (§5.4 FIFO dispatch,
  // 2026-08-28, see DECISIONS.md "CHIQIM quantity-based dispatch: FIFO
  // cascade, consumption table"). No pallet picker any more: a
  // finished/old_washed row is quantity + declared tare, exactly like every
  // other line kind already was, and Ombor's own loaded-kg entry at
  // finalization is what the FIFO cascade actually attributes against —
  // this is a declared figure, never overwritten by that (CLAUDE.md
  // "declared vs actual are separate persisted fields").
  qty: string
  // Declared tare (finished/old_washed only) -- additive to qty (net), per
  // migration 0087's chiqim_lines.declared_tara_kg. NULL/unused for every
  // other kind.
  taraKg: string
  // Raw dispatch pool — every serial Menejer names as a SOURCE for this
  // line, persisted to chiqim_line_raw_serials on submit. Unlike the old
  // finished/old_washed picker this has no relationship to qty — "these are
  // your sources," not an allocation. raw/old_raw rows only.
  rawSerialPool: Set<string>
}

function newRow(): LineRow {
  return { key: crypto.randomUUID(), kind: 'finished', typeId: '', calibreId: '', qty: '', taraKg: '', rawSerialPool: new Set() }
}

interface SavedLine {
  key: string
  kind: LineKind
  typeId: string
  calibreId: string
  rawSerialPool: string[]
  qtyKg: number | null
  taraKg: number | null
}

const PALLET_KINDS: LineKind[] = ['finished', 'old_washed']
const POOL_KINDS: LineKind[] = ['raw', 'old_raw']
const OLD_STOCK_KINDS: LineKind[] = ['old_washed', 'old_kn', 'old_raw']

// §3.1 CHIQIM form: Sana · Moshina · Haydovchi · Buyurtmachi · repeatable
// Tur + Kalibr + Miqdori rows (calibre set incl. Konditirskiy) · Jami avto.
// 🔒 No serial, no doc photo (unlike KIRIM) — see §3.1.
//
// §5.4 FIFO dispatch (2026-08-28, reverses the 2026-07-26/27 "Option B"
// pallet-reservation design — see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table"): a finished/old_washed line
// is quantity-only again (calibre + declared net kg + declared tare kg),
// same shape as every other line kind — no pallet picker, no reservation.
// Which specific finished_pallets rows actually get consumed is decided at
// Ombor's finalize click, by FIFO over receipt date (attribute_chiqim_line_
// fifo, migrations 0087/0089), never here. The feasibility hint below is a
// soft warning only (never blocks) against the SAME canonical availability
// balance that FIFO draws down against at finalization — it can go stale
// between form-load and finalize (another request claims the stock first);
// FIFO's own hard-fail-if-insufficient is the real guard for that race.
export function ChiqimForm({ onSaved }: { onSaved: () => void }) {
  const { profile } = useAuth()
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
  const { calibres } = useCalibres()
  const { rows: availabilityRows } = useFinishedCalibreAvailability()
  // Old KN pool balance only, now — the finished/old_washed picker that used
  // to read stock_on_hand_rows for real pallets is gone (see module comment
  // above); qoldig'i's own old_kn bucket is still the one source of truth
  // for "how much is left in this pool."
  const { rows: stockRows } = useStockOnHand()
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

  // Old KN (Stage 2) — this owner's pool balance for a given type, read off
  // the same stock_on_hand_rows old_kn bucket qoldig'i itself reads (never
  // a second source of truth for "how much is left"). At most one row per
  // type (old_kn_pools' own unique(owner_id, type_id)).
  function oldKnPoolBalance(row: LineRow): number | null {
    if (row.kind !== 'old_kn' || !ownerId || !row.typeId) return null
    const pool = stockRows.find((r) => r.bucket === 'old_kn' && r.ownerId === ownerId && r.typeId === row.typeId)
    return pool ? pool.qtyKg : null
  }

  // Total-by-calibre availability (finished_calibre_availability, migrations
  // 0087/0089) for a finished/old_washed row's own type+calibre+isOldStock —
  // the two-level balance's TOTAL level; the per-parent-serial level is
  // reporting-only (passport), not something this form needs.
  function availableKg(row: LineRow): number {
    if (!PALLET_KINDS.includes(row.kind) || !row.typeId || !row.calibreId) return 0
    const wantOldStock = row.kind === 'old_washed'
    const match = availabilityRows.find(
      (a) => a.type_id === row.typeId && a.calibre_id === row.calibreId && a.is_old_stock === wantOldStock,
    )
    return match ? match.available_kg : 0
  }

  // Raw dispatch pool (2026-08-01) — this client's own raw serials with a
  // positive balance, matching this row's type: the candidate POOL, not a
  // single pick. Sorted oldest-first (requirement 5, "aged raw moves before
  // fresh") — deliberately the OPPOSITE of useMoykaSerials' own newest-first
  // default, which stays as-is (load-bearing for §5.2 Window 1 elsewhere);
  // this is a local sort of the same data for this picker only. Opening
  // stock (Stage 2) splits this pool by isOldStock the same way the old
  // finished/old_washed picker used to split — the regular Xom tab never
  // offers an old-raw serial and vice versa.
  function matchingRawSerials(row: LineRow): MoykaSerial[] {
    if (!POOL_KINDS.includes(row.kind) || !ownerId || !row.typeId) return []
    const wantOldStock = row.kind === 'old_raw'
    return rawSerials
      .filter((s) => s.owner_id === ownerId && s.type_id === row.typeId && s.available > 0 && s.isOldStock === wantOldStock)
      .sort((a, b) => a.order_date.localeCompare(b.order_date))
  }

  // Toggling a raw serial adds/removes it from this row's pool — a named
  // list of SOURCES, not an allocation (the task's own framing): unlike a
  // finished/old_washed row's plain qty input, this never touches qty. The
  // pool's total available has no relationship to what Menejer eventually
  // types (if anything) — Ombor decides how much comes from each serial on
  // the floor.
  function toggleRawSerial(row: LineRow, serial: MoykaSerial) {
    const next = new Set(row.rawSerialPool)
    if (next.has(serial.serial)) next.delete(serial.serial)
    else next.add(serial.serial)
    updateRow(row.key, { rawSerialPool: next })
  }

  function feasibilityHint(row: LineRow): string | null {
    if (!PALLET_KINDS.includes(row.kind)) return null
    const target = parseFloat(row.qty)
    if (!row.typeId || !row.calibreId || !(target > 0)) return null
    const avail = availableKg(row)
    if (target <= avail) return null // enough stock — nothing to flag
    return `Omborda yetarli emas — mavjud: ${Math.round(avail).toLocaleString()} kg`
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const validRows = rows.filter((r) => {
      if (PALLET_KINDS.includes(r.kind)) return r.typeId && r.calibreId && parseFloat(r.qty) > 0 && parseFloat(r.taraKg) >= 0
      if (POOL_KINDS.includes(r.kind)) return r.typeId && r.rawSerialPool.size > 0
      return r.typeId // old_kn — no calibre, no pool, just a type against the one pool that owner/type has
    })
    if (!ownerId || !plate || !driver || validRows.length === 0) {
      setError('Barcha maydonlarni to\'ldiring va kamida bitta tur/kalibr yoki xom qatorini kiriting.')
      return
    }
    // App-level guard (2026-08-01 feedback, extended to old_raw in Stage 2):
    // the DB can't enforce "a raw line has at least one pooled serial"
    // across two tables, so a raw/old_raw row with a type chosen but zero
    // serials picked must be caught HERE, explicitly — not just silently
    // dropped by the validRows filter above, which would let it vanish
    // unremarked if another row on the same form happened to be valid
    // (validRows.length === 0 alone wouldn't catch it).
    const emptyPoolRawRows = rows.filter((r) => POOL_KINDS.includes(r.kind) && r.typeId && r.rawSerialPool.size === 0)
    if (emptyPoolRawRows.length > 0) {
      setError("Bir yoki bir nechta xom qatorida manba seriya tanlanmagan — kamida bitta seriya tanlang yoki qatorni o'chiring.")
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

      const lineInserts = validRows.map((r) => ({
        request_id: request.id,
        type_id: r.typeId,
        calibre_id: PALLET_KINDS.includes(r.kind) ? r.calibreId : null,
        line_kind: r.kind,
        qty_kg: r.qty ? parseFloat(r.qty) : null,
        declared_tara_kg: PALLET_KINDS.includes(r.kind) ? parseFloat(r.taraKg) : null,
      }))
      const { data: lines, error: lineErr } = await supabase.from('chiqim_lines').insert(lineInserts).select('id')
      if (lineErr) throw lineErr

      // Raw dispatch pool — each raw row's chosen sources are batch-inserted
      // into the junction table. Relies on insert-order === select-order,
      // same as the original single-request batch insert this replaces
      // (no reservation race to worry about any more — chiqim_line_pallets
      // is gone, so there's nothing sequential-insert was protecting here).
      const rawPoolRows = validRows.flatMap((r, i) => {
        if (!POOL_KINDS.includes(r.kind)) return []
        const lineId = lines![i].id
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
          taraKg: PALLET_KINDS.includes(r.kind) && r.taraKg ? parseFloat(r.taraKg) : null,
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
              // A different client invalidates every raw/old_raw row's own
              // picked source-serial pool (it was scoped to the PREVIOUS
              // client's stock).
              setRows((r) => r.map((row) => ({ ...row, rawSerialPool: new Set() })))
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
          const rawMatches = matchingRawSerials(row)
          const oldKnBalance = oldKnPoolBalance(row)
          const pickerActive = PALLET_KINDS.includes(row.kind)
            ? !!ownerId && !!row.typeId && !!row.calibreId
            : !!ownerId && !!row.typeId
          return (
            <Card key={row.key} padding="compact">
              {/* Raw dispatch (2026-07-31) — a row is either a finished-
                  calibre line or a raw line pinned to one raw serial (§ see
                  LineRow's own comment). Switching kind clears whatever the
                  other kind had picked, same "stale selection" reasoning the
                  owner/type/calibre onChange handlers already use below.
                  Opening stock (Stage 2) adds a third top-level tab whose
                  three shapes (old_washed/old_kn/old_raw) pick via a second
                  row of sub-buttons — kept as a separate tab rather than
                  folded into Kalibrlangan/Xom because none of old stock's
                  three shapes are a clean fit for either (KN in particular
                  has no calibre and no pool, matching neither). */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateRow(row.key, { kind: 'finished', rawSerialPool: new Set(), qty: '', taraKg: '' })}
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
                  onClick={() => updateRow(row.key, { kind: 'raw', calibreId: '', qty: '', taraKg: '' })}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    row.kind === 'raw'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  Xom
                </button>
                <button
                  type="button"
                  onClick={() =>
                    !OLD_STOCK_KINDS.includes(row.kind) &&
                    updateRow(row.key, { kind: 'old_washed', rawSerialPool: new Set(), qty: '', taraKg: '' })
                  }
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    OLD_STOCK_KINDS.includes(row.kind)
                      ? 'bg-amber-700 text-white dark:bg-amber-600'
                      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
                  }`}
                >
                  Eski zaxira
                </button>
                {OLD_STOCK_KINDS.includes(row.kind) && (
                  <span className="inline-flex gap-1 rounded-md bg-amber-50 p-0.5 dark:bg-amber-950/40">
                    {(
                      [
                        ['old_washed', 'Yuvilgan'],
                        ['old_kn', 'KN'],
                        ['old_raw', 'Xom'],
                      ] as [LineKind, string][]
                    ).map(([subKind, label]) => (
                      <button
                        key={subKind}
                        type="button"
                        onClick={() =>
                          updateRow(row.key, {
                            kind: subKind,
                            calibreId: subKind === 'old_washed' ? row.calibreId : '',
                            rawSerialPool: new Set(),
                            qty: '',
                            taraKg: '',
                          })
                        }
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          row.kind === subKind
                            ? 'bg-white text-amber-900 shadow-sm dark:bg-slate-900 dark:text-amber-300'
                            : 'text-amber-700 hover:bg-white/60 dark:text-amber-400 dark:hover:bg-slate-900/60'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <select
                  required
                  value={row.typeId}
                  onChange={(e) => updateRow(row.key, { typeId: e.target.value, rawSerialPool: new Set(), qty: '', taraKg: '' })}
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
                {PALLET_KINDS.includes(row.kind) && (
                  <select
                    required
                    value={row.calibreId}
                    onChange={(e) => updateRow(row.key, { calibreId: e.target.value })}
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
                  required={PALLET_KINDS.includes(row.kind)}
                  placeholder={PALLET_KINDS.includes(row.kind) ? 'Sof miqdor (kg)' : 'Taxminiy miqdor (ixtiyoriy)'}
                  value={row.qty}
                  onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                  className="w-36"
                />
                {/* Declared tara (§5.4 FIFO dispatch, 2026-08-28) — additive
                    to the net kg above, chiqim_lines.declared_tara_kg
                    (migration 0087). finished/old_washed only, same as
                    calibre. */}
                {PALLET_KINDS.includes(row.kind) && (
                  <TextInput
                    type="number"
                    min="0"
                    step="0.1"
                    required
                    placeholder="Tara (kg)"
                    value={row.taraKg}
                    onChange={(e) => updateRow(row.key, { taraKg: e.target.value })}
                    className="w-32"
                  />
                )}
                {rows.length > 1 && (
                  <IconButton label="Qatorni o'chirish" tone="danger" onClick={() => removeRow(row.key)}>
                    ✕
                  </IconButton>
                )}
              </div>

              {pickerActive && row.kind === 'old_kn' && (
                <div className="mt-2 border-t border-amber-200 pt-2 dark:border-amber-900">
                  <p className="text-xs text-slate-400">
                    Eski KN havzasidan — bitta havza har bir tur uchun. Ombor haqiqiy og'irlikni yuklash paytida
                    kiritadi.
                  </p>
                  <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-400">
                    {oldKnBalance === null ? 'Bu turda eski KN havzasi yo\'q.' : `Havzada mavjud: ${Math.round(oldKnBalance).toLocaleString()} kg`}
                  </p>
                </div>
              )}

              {pickerActive && POOL_KINDS.includes(row.kind) && (
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
                            <PartiyaBadge partiyaNo={s.partiyaNo} />
                            <span className="ml-1.5">{Math.round(s.available).toLocaleString()} kg mavjud</span>
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
            {
              rows.filter((r) => {
                if (!r.typeId) return false
                if (PALLET_KINDS.includes(r.kind)) return !!r.calibreId
                if (POOL_KINDS.includes(r.kind)) return r.rawSerialPool.size > 0
                return true // old_kn
              }).length
            }{' '}
            qator
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
                {line.kind === 'finished' && calibreLabel(line.calibreId)}
                {line.kind === 'old_washed' && `Eski zaxira (yuvilgan) · ${calibreLabel(line.calibreId)}`}
                {line.kind === 'old_kn' && 'Eski zaxira (KN)'}
                {(line.kind === 'raw' || line.kind === 'old_raw') &&
                  `${line.kind === 'old_raw' ? 'Eski zaxira (xom) · ' : 'Xom · '}${line.rawSerialPool.join(', ')}`}
              </span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {line.qtyKg === null ? '—' : `${line.qtyKg.toLocaleString()} kg`}
                {line.taraKg !== null && ` (+${line.taraKg.toLocaleString()} kg tara)`}
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
