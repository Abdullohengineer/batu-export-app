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
// current full-size-inline look) renders a small clickable image instead:
// no separate thumbnail asset exists anywhere in this app, so "opens
// full-size" is simply an `<a target="_blank">` around the same signed URL
// at native resolution — the browser's own image view, not a new lightbox
// component for a first use case this small.
export function GatePhoto({
  path,
  label,
  bucket = 'gate-photos',
  thumbnail = false,
}: {
  path: string | null
  label: string
  bucket?: string
  thumbnail?: boolean
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
    return (
      <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="block w-20 shrink-0">
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</div>
        {url && (
          <img
            src={url}
            alt={label}
            className="mt-1 h-20 w-20 rounded-md border border-slate-200 object-cover dark:border-slate-700"
          />
        )}
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
