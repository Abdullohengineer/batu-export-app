import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Calibre {
  id: string
  category_id: string
  code: string // '04' | '06' | 'KN' … — used in Barcode #2 (PLT-<serial>-<code>)
  label: string // 'Kalibr 4' | 'Konditirskiy'
  is_numberless: boolean // true for Konditirskiy
  sort_order: number
  active: boolean
}

// SPEC §2.3 / §5.3 calibre master data. §3.3 added the `active` flag
// (calibres was the one master table missing it). Default
// (includeInactive=false) is for NEW-ENTRY dropdowns only — any id->label
// RESOLUTION for a historical row, or any filter/selection over existing
// data, must pass includeInactive: true (see useOwners.ts for the full
// rationale) — this matters more here than elsewhere, since is_numberless
// also drives re-wash logic (OmborTayyorTab.handleRewash), not just display.
// `refetch` lets the Sozlamalar admin screen reload after a mutation.
export function useCalibres(includeInactive = false) {
  const [calibres, setCalibres] = useState<Calibre[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('calibres')
        .select('id, category_id, code, label, is_numberless, sort_order, active')
        .order('sort_order')
      if (!includeInactive) query = query.eq('active', true)
      const { data } = await query
      setCalibres(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [includeInactive])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { calibres, loading, refetch }
}
