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

  async function handleFile(file: File | null) {
    setSizes(null)
    if (!file) {
      onChange(null)
      return
    }

    setCompressing(true)
    try {
      const { blob, originalSize, compressedSize } = await compressImage(file)
      setSizes({ original: originalSize, compressed: compressedSize })
      onChange(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
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
    </div>
  )
}
