import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Signed-URL photo display, default bucket `gate-photos` — same pattern as
// IntakeDetailView.tsx's pile-photo display (createSignedUrl, 1hr expiry),
// generalized so every gate photo column (stage1_plate_photo,
// stage1_scale_photo, stage2_scale_photo, departure_doc_photo) can reuse it
// instead of four copies of the same useEffect. `bucket` is additive —
// defaults to `gate-photos` so every existing call site is unchanged;
// Laborator's `lab-photos` bucket is the first other consumer.
//
// `thumbnail` (additive, default false — every existing call site keeps its
// current full-size-inline look) renders a small clickable image instead —
// no visible caption (the field-table row it sits in already carries the
// label), just the bare image. `onOpen`, if given, is called with the
// resolved URL + label instead of the default `target="_blank"` behaviour —
// the serial passport (§3.2.5, restructure task) uses this to open an
// in-page lightbox rather than a new browser tab.
export function GatePhoto({
  path,
  label,
  bucket = 'gate-photos',
  thumbnail = false,
  onOpen,
}: {
  path: string | null
  label: string
  bucket?: string
  thumbnail?: boolean
  onOpen?: (url: string, label: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [path, bucket])

  if (!path) return null

  if (thumbnail) {
    if (!url) return null
    const thumbClass = 'block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700'
    if (onOpen) {
      return (
        <button type="button" onClick={() => onOpen(url, label)} className={thumbClass} aria-label={label}>
          <img src={url} alt={label} className="h-full w-full object-cover" />
        </button>
      )
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={thumbClass}>
        <img src={url} alt={label} className="h-full w-full object-cover" />
      </a>
    )
  }

  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      {url && (
        <img
          src={url}
          alt={label}
          className="mt-1 max-w-xs rounded-md border border-slate-200 dark:border-slate-700"
        />
      )}
    </div>
  )
}
