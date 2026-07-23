import { useState } from 'react'
import { compressImage, formatBytes } from '../lib/imageCompress'

// Nav/visual-redesign pass (Qorovul prompt, mockup "BATU-Qorovul-Screens-
// v1_1.pdf" stage-form pages): a bordered box that tones to green once a
// photo is attached, showing the filename alongside the size-reduction line
// this already had. Restyled AROUND the upload path only -- `accept`,
// `required`, the gallery-first `<input type=file>` itself, `compressImage`,
// and the decode-fallback error handling below are all byte-for-byte
// unchanged from before this pass. The `<label>` renders ONLY the raw
// `label` text (no "majburiy" suffix inside it) and the required-badge is a
// sibling `<span>`, not nested inside the label -- e2e locates these fields
// via `label:text-is("Tarozi rasmi")` etc. (exact match), so anything
// appended inside the label itself would break every gate test in the suite.
export function PhotoField({
  label,
  required,
  onChange,
}: {
  label: string
  required?: boolean
  onChange: (file: File | null) => void
}) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [sizes, setSizes] = useState<{ original: number; compressed: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    setSizes(null)
    setFileName(null)
    setError(null)
    if (!file) {
      onChange(null)
      return
    }

    setCompressing(true)
    try {
      const { blob, originalSize, compressedSize } = await compressImage(file)
      setSizes({ original: originalSize, compressed: compressedSize })
      const renamed = file.name.replace(/\.\w+$/, '.jpg')
      setFileName(renamed)
      onChange(new File([blob], renamed, { type: 'image/jpeg' }))
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
      setFileName(null)
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

  const attached = Boolean(fileName && sizes)

  return (
    <div
      className={`rounded-md border p-3 ${
        attached
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
          : 'border-slate-300 dark:border-slate-700'
      }`}
    >
      <label className="inline-block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      {required && (
        <span className="ml-2 align-middle text-xs font-semibold text-red-600 dark:text-red-400">majburiy</span>
      )}
      <input
        type="file"
        accept="image/*"
        required={required}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-sm text-slate-700 dark:text-slate-300"
      />
      {compressing && <p className="mt-1 text-xs text-slate-400">Siqilmoqda…</p>}
      {attached && (
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
            IMG
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{fileName}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {formatBytes(sizes!.original)} → <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatBytes(sizes!.compressed)}</span> · avtomatik siqildi
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
