import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { compressImage, formatBytes } from '../../lib/imageCompress'
import { useAuth } from '../../lib/AuthProvider'

interface TypeRow {
  key: string
  typeId: string
  qty: string
}

function newRow(): TypeRow {
  return { key: crypto.randomUUID(), typeId: '', qty: '' }
}

interface SavedLine {
  key: string
  typeId: string
  serial: string | null // null while the insert is still in flight
}

export function KirimForm({ onSaved }: { onSaved: () => void }) {
  const { profile } = useAuth()
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()

  const [sana, setSana] = useState(() => new Date().toISOString().slice(0, 10))
  const [plate, setPlate] = useState('')
  const [driver, setDriver] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [rows, setRows] = useState<TypeRow[]>([newRow()])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoSizes, setPhotoSizes] = useState<{ original: number; compressed: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
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
    if (!file) return

    setCompressing(true)
    try {
      const { blob, originalSize, compressedSize } = await compressImage(file)
      setPhotoSizes({ original: originalSize, compressed: compressedSize })
      setPhotoFile(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
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
    setSavedLines(validRows.map((r) => ({ key: r.key, typeId: r.typeId, serial: null })))

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
          })),
        )
        .select('serial, type_id')
      if (linesErr) throw linesErr

      setSavedLines(
        validRows.map((r) => {
          const match = lines.find((l) => l.type_id === r.typeId)
          return { key: r.key, typeId: r.typeId, serial: match?.serial ?? null }
        }),
      )

      setPlate('')
      setDriver('')
      setOwnerId('')
      setRows([newRow()])
      setPhotoFile(null)
      setPhotoSizes(null)
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
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yangi KIRIM</h2>

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
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tur + Miqdori</span>
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-medium text-slate-700 underline dark:text-slate-300"
          >
            + Tur qo'shish
          </button>
        </div>

        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
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
        ))}
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
        <span className="font-medium text-slate-700 dark:text-slate-300">Jami avto</span>
        <span className="font-semibold text-slate-900 dark:text-slate-100">{jamiAvto.toLocaleString()} kg</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Hujjat rasmi</label>
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
              <span className="text-slate-600 dark:text-slate-400">{typeName(line.typeId)}</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {line.serial ? line.serial : 'seriya: kutilmoqda'}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || compressing}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  )
}
