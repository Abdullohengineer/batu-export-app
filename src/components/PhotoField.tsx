import { useState } from 'react'
import { compressImage, formatBytes } from '../lib/imageCompress'

export function PhotoField({
  label,
  required,
  onChange,
}: {
  label: string
  required?: boolean
  onChange: (file: File | null) => void
}) {
  const [sizes, setSizes] = useState<{ original: number; compressed: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    setSizes(null)
    setError(null)
    if (!file) {
      onChange(null)
      return
    }

    setCompressing(true)
    try {
      const { blob, originalSize, compressedSize } = await compressImage(file)
      setSizes({ original: originalSize, compressed: compressedSize })
      onChange(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
    } catch (err) {
      // Previously unhandled -- compressImage's createImageBitmap/canvas.toBlob
      // can throw on real-device photos (see docs/DECISIONS.md "Qorovul photo
      // upload silent failure"), and with no catch here that exception just
      // vanished: onChange never fired, the field looked idle again, nothing
      // was ever attached. Explicitly clearing to null (not leaving a stale
      // previously-attached file in place) so required-field validation
      // blocks submit the same way whether this is a first attempt or a
      // failed replacement of an already-attached photo.
      onChange(null)
      setError("Rasmni siqishda xatolik yuz berdi — boshqa rasm tanlang yoki qayta urinib ko'ring.")
      // Logged deliberately (no other component in this app does this) --
      // the current investigation's own next step is capturing the real
      // thrown error via real-device remote debugging (Safari Web Inspector /
      // chrome://inspect); without this, catching the error here would hide
      // it from that console instead of just no longer crashing on it.
      console.error('PhotoField: compressImage failed', err)
    } finally {
      setCompressing(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        type="file"
        accept="image/*"
        required={required}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        className="mt-1 w-full text-sm text-slate-700 dark:text-slate-300"
      />
      {compressing && <p className="mt-1 text-xs text-slate-400">Siqilmoqda…</p>}
      {sizes && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {formatBytes(sizes.original)} → {formatBytes(sizes.compressed)}
        </p>
      )}
      {error && (
        <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
