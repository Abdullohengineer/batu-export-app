import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ManifestLine {
  id: string
  barcode2: string
  type_id: string
  calibre_id: string
  weight_kg: number
}

// §5.4 Ombor CHIQIM "undo scan" — dispatch_manifest doesn't persist which
// chiqim_line a pallet was assigned to (only request_id + barcode2), so
// there's nothing durable to regroup by line once Ombor's finish click has
// happened; matches "Totals are DERIVED, nothing stored" elsewhere in this
// app. Grouping stays flat (per pallet), same as the totals recomputed
// live from the list.
//
// Only fetches when requestId is non-null — same "never fetched eagerly"
// rule as the rest of this component's expand panels (see
// OmborChiqimTab.tsx's own header comment).
export function useDispatchManifestLines(requestId: string | null) {
  const [lines, setLines] = useState<ManifestLine[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!requestId) {
      setLines([])
      return
    }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('dispatch_manifest')
        .select('id, barcode2, finished_pallets(type_id, calibre_id, weight_kg)')
        .eq('request_id', requestId)
      setLines(
        (data ?? []).map((row) => {
          const pallet = row.finished_pallets as unknown as { type_id: string; calibre_id: string; weight_kg: number } | null
          return {
            id: row.id,
            barcode2: row.barcode2,
            type_id: pallet?.type_id ?? '',
            calibre_id: pallet?.calibre_id ?? '',
            weight_kg: pallet?.weight_kg ?? 0,
          }
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { lines, loading, refresh }
}
