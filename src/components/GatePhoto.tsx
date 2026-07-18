import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Signed-URL photo display for the `gate-photos` bucket — same pattern as
// IntakeDetailView.tsx's pile-photo display (createSignedUrl, 1hr expiry),
// generalized so every gate photo column (stage1_plate_photo,
// stage1_scale_photo, stage2_scale_photo, departure_doc_photo) can reuse it
// instead of four copies of the same useEffect.
export function GatePhoto({ path, label }: { path: string | null; label: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    let cancelled = false
    supabase.storage
      .from('gate-photos')
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return null

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
