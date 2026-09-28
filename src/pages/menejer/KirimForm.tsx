import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { invalidateReportData } from '../../lib/queryClient'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { compressImage, formatBytes } from '../../lib/imageCompress'
import { useAuth } from '../../lib/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { IconButton } from '../../components/ui/IconButton'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { toneStyles } from '../../components/ui/tokens'
import { RezkaBadge } from '../../components/ui/RezkaBadge'
import { todayInTashkent } from '../../lib/dateRange'

// Rezka Prompt 3 (SPEC.md §2.1 / §5.R): process rides the LINE, not the
// truck -- one truck can carry Moyka and Rezka lines, and fura/normal is
// independent of it. Fixed at creation: kirim_lines has no Menejer UPDATE
// policy and there is no line edit path (KirimOrdersList's Tahrirlash only
// touches order date/plate/driver).
type LineProcess = 'moyka' | 'rezka'

interface TypeRow {
  key: string
  typeId: string
  process: LineProcess
  qty: string
}

function newRow(): TypeRow {
  return { key: crypto.randomUUID(), typeId: '', process: 'moyka', qty: '' }
}

interface SavedLine {
  key: string
  typeId: string
  process: LineProcess
  serial: string | null // null while the insert is still in flight
}

export function KirimForm({ onSaved }: { onSaved: () => void }) {
  const { profile } = useAuth()
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()

  const [sana, setSana] = useState(() => todayInTashkent())
  const [plate, setPlate] = useState('')
  const [driver, setDriver] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [rows, setRows] = useState<TypeRow[]>([newRow()])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoSizes, setPhotoSizes] = useState<{ original: number; compressed: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
  // This form's own compression call had the exact same missing-catch
  // defect as PhotoField.tsx's (see docs/DECISIONS.md "Qorovul photo
  // upload silent failure") -- just never noticed, because setPhotoFile(file)
  // below sets the RAW file before compression is attempted, so a
  // compression failure here silently uploaded the uncompressed original
  // instead of losing the photo outright. Kept as-is (raw file stays
  // attached on failure, submit still proceeds with it) -- only the
  // silence is fixed here, not that fallback behavior, which is this
  // form's own pre-existing design, not something this task asked to change.
  const [photoError, setPhotoError] = useState<string | null>(null)
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

  function updateRow(key: string, patch: Partial<TypeRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function handlePhotoChange(file: File | null) {
    setPhotoFile(file)
    setPhotoSizes(null)
    setPhotoError(null)
    if (!file) return

    setCompressing(true)
    try {
      const { blob, originalSize, compressedSize } = await compressImage(file)
      setPhotoSizes({ original: originalSize, compressed: compressedSize })
      setPhotoFile(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
    } catch (err) {
      setPhotoError("Rasmni siqishda xatolik yuz berdi — boshqa rasm tanlang yoki qayta urinib ko'ring.")
      console.error('KirimForm: compressImage failed', err)
    } finally {
      setCompressing(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const validRows = rows.filter((r) => r.typeId && parseFloat(r.qty) > 0)
    if (!ownerId || !plate || !driver || validRows.length === 0) {
      setError('Barcha maydonlarni to\'ldiring va kamida bitta tur qatorini kiriting.')
      return
    }

    setSubmitting(true)
    // §2.1/§3.1: real serials only come from next_serial() in the database.
    // This is just a UI placeholder shown while that insert is in flight.
    setSavedLines(validRows.map((r) => ({ key: r.key, typeId: r.typeId, process: r.process, serial: null })))

    try {
      let docPhotoPath: string | null = null
      if (photoFile) {
        const path = `${crypto.randomUUID()}.jpg`
        const { error: uploadErr } = await supabase.storage.from('kirim-photos').upload(path, photoFile)
        if (uploadErr) throw uploadErr
        docPhotoPath = path
      }

      const { data: order, error: orderErr } = await supabase
        .from('kirim_orders')
        .insert({
          order_date: sana,
          plate,
          driver,
          owner_id: ownerId,
          doc_photo: docPhotoPath,
          declared_total: jamiAvto,
          created_by: profile?.id,
        })
        .select('order_id')
        .single()
      if (orderErr) throw orderErr

      // next_serial() is called once per line here — one insert, N rows,
      // N independent DEFAULT evaluations. Never generated in JavaScript.
      const { data: lines, error: linesErr } = await supabase
        .from('kirim_lines')
        .insert(
          validRows.map((r) => ({
            order_id: order.order_id,
            type_id: r.typeId,
            declared_qty: parseFloat(r.qty),
            process: r.process,
          })),
        )
        .select('serial, type_id, process')
      if (linesErr) throw linesErr

      setSavedLines(
        validRows.map((r) => {
          // type_id + process (Rezka Prompt 3): Subxon-Moyka and Subxon-Rezka
          // on one truck are two different serials. Two lines with the SAME
          // type AND process still collide here -- flagged in HANDOFF.md.
          const match = lines.find((l) => l.type_id === r.typeId && l.process === r.process)
          return { key: r.key, typeId: r.typeId, process: r.process, serial: match?.serial ?? null }
        }),
      )

      setPlate('')
      setDriver('')
      setOwnerId('')
      setRows([newRow()])
      setPhotoFile(null)
      setPhotoSizes(null)
      // 0211: KIRIM intake -- both the order and its lines land a new
      // delivery on the ledger (declared_qty), which report_query_page,
      // rahbar_stock_snapshot etc. all read.
      invalidateReportData()
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      {/* Text stays "Yangi KIRIM" (not the mockup's "Yangi kiruvchi
          buyurtma") -- e2e asserts getByRole('heading', {name:'Yangi
          KIRIM'}) in full-chain/rewash-hard-gate/chiqim-undo-scan specs.
          Only the tone (mockup's blue section-title treatment) changed. */}
      <SectionHeading tone="info">Yangi KIRIM</SectionHeading>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Sana">
          <TextInput type="date" required value={sana} onChange={(e) => setSana(e.target.value)} />
        </FormField>
        {/* Not FormField for this field or the next: e2e locates both via
            `div:has(> label:text-is(...)) > input` -- a DIRECT-CHILD
            combinator on the input. FormField wraps children in its own
            `div.mt-1`, which would put the input one level too deep.
            TextInput alone keeps label and input as direct siblings, same
            fix as the composite-label cases in the Laborator/Ombor forms.
            (Confirmed by an actual e2e run: this exact wrapping broke
            "Haydovchi ismi" the first time through.) */}
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
            onChange={(e) => setOwnerId(e.target.value)}
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
          Mahsulotlar — bir moshinada bir nechta tur bo'lsa qator qo'shing
        </span>

        {rows.map((row) => (
          // className="space-y-1" preserved from the original row div: e2e
          // locates the Nth row via `form div.space-y-1.rounded-md` (full-
          // chain.spec.ts, rewash-hard-gate.spec.ts) -- confirmed by an
          // actual e2e run when this was first dropped during the Card swap.
          <Card key={row.key} padding="compact" className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                required
                value={row.typeId}
                onChange={(e) => updateRow(row.key, { typeId: e.target.value })}
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
              {/* Process toggle, not a <select>: full-chain/partiya-raqami
                  specs pick the type with row.locator('select'), which a
                  second select in this row would make ambiguous. Same
                  segmented-button pattern as ChiqimForm's Transport turi. */}
              <div role="group" aria-label="Jarayon" className="inline-flex shrink-0 gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
                {(
                  [
                    ['moyka', 'Moyka'],
                    ['rezka', 'Rezka'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={row.process === value}
                    onClick={() => updateRow(row.key, { process: value })}
                    className={`rounded px-2.5 py-1.5 text-xs font-medium ${
                      row.process === value
                        ? value === 'rezka'
                          ? 'bg-violet-700 text-white dark:bg-violet-600'
                          : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <TextInput
                type="number"
                min="0"
                step="0.1"
                required
                placeholder="Miqdori (kg)"
                value={row.qty}
                onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                className="w-40"
              />
              {rows.length > 1 && (
                <IconButton label="Qatorni o'chirish" tone="danger" onClick={() => removeRow(row.key)}>
                  ✕
                </IconButton>
              )}
            </div>
          </Card>
        ))}

        <Button
          type="button"
          variant="ghost"
          size="md"
          fullWidth
          onClick={addRow}
          className="border border-dashed !border-blue-300 !text-blue-700 hover:bg-blue-50 dark:!border-blue-800 dark:!text-blue-400 dark:hover:bg-blue-950/30"
        >
          + Tur qo'shish
        </Button>
      </div>

      <Card tone="info">
        <div className="flex items-center justify-between text-sm">
          <span className={`font-medium ${toneStyles.info.text}`}>Jami (avto)</span>
          <span className={`font-semibold ${toneStyles.info.text}`}>
            {jamiAvto.toLocaleString()} kg · {rows.filter((r) => r.typeId).length} tur
          </span>
        </div>
      </Card>

      {/* Mockup shows a "Seriya raqami ... avtomatik" preview box here, but
          the real serial only exists once next_serial() runs server-side on
          insert (§2.1/§3.1) -- there is nothing real to show before submit.
          This note keeps the mockup's intent (serial is automatic, not
          typed) without fabricating a number; the real one still appears in
          the savedLines panel below once the insert actually returns it. */}
      <Card tone="info">
        <span className={`text-sm font-medium ${toneStyles.info.text}`}>Seriya raqami</span>
        <span className={`block text-sm ${toneStyles.info.text}`}>Saqlagandan keyin avtomatik beriladi</span>
      </Card>

      <div className="rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Hujjat rasmi <span className="font-normal text-slate-400">· ixtiyoriy</span>
        </label>
        <p className="mt-1 text-xs text-slate-400">Mijoz nakladnoyasini biriktirish</p>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm text-slate-700 dark:text-slate-300"
        />
        {compressing && <p className="mt-1 text-xs text-slate-400">Siqilmoqda…</p>}
        {photoSizes && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {formatBytes(photoSizes.original)} → {formatBytes(photoSizes.compressed)}
          </p>
        )}
        {photoError && (
          <div className="mt-1">
            <StatusNote tone="problem">{photoError}</StatusNote>
          </div>
        )}
      </div>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {savedLines && (
        <Card>
          {savedLines.map((line) => (
            <div key={line.key} className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                {typeName(line.typeId)}
                {line.process === 'rezka' && <RezkaBadge provenance="tashqi" />}
              </span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {line.serial ? line.serial : 'seriya: kutilmoqda'}
              </span>
            </div>
          ))}
        </Card>
      )}

      <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting || compressing}>
        {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
      </Button>
    </form>
  )
}
