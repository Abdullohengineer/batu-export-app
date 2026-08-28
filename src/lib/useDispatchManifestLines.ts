import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ManifestLine {
  id: string
  barcode2: string
  type_id: string
  calibre_id: string
  // The portion of this pallet actually attributed to this request by FIFO
  // (chiqim_pallet_consumption.qty_kg) — NOT the whole pallet's weight_kg,
  // since one pallet can now be split across several requests (§5.4 FIFO
  // dispatch, 2026-08-28).
  weight_kg: number
}

// §5.4 FIFO dispatch (2026-08-28, see DECISIONS.md "CHIQIM quantity-based
// dispatch: FIFO cascade, consumption table") — reads chiqim_pallet_
// consumption instead of dispatch_manifest, which the same change stopped
// writing to (kept as a historical, now-permanently-empty-for-new-requests
// table, same "keep table, stop writing" precedent as wash_cycles/0086).
// Grouping stays flat (per consumption row = per pallet-portion), matching
// the totals recomputed live from the list, same as before this change.
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
        .from('chiqim_pallet_consumption')
        .select('id, barcode2, qty_kg, chiqim_lines!inner(request_id), finished_pallets(type_id, calibre_id)')
        .eq('chiqim_lines.request_id', requestId)
      setLines(
        (data ?? []).map((row) => {
          const pallet = row.finished_pallets as unknown as { type_id: string; calibre_id: string } | null
          return {
            id: row.id,
            barcode2: row.barcode2,
            type_id: pallet?.type_id ?? '',
            calibre_id: pallet?.calibre_id ?? '',
            weight_kg: row.qty_kg,
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
