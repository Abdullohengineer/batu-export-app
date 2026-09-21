import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys, MASTER_DATA_STALE_TIME_MS } from './queryClient'

export interface Calibre {
  id: string
  category_id: string
  code: string // '04' | '06' | 'KN' | 'RKN' … — used in Barcode #2 (PLT-<serial>-<code>)
  label: string // 'Kalibr 4' | 'Konditirskiy'
  is_numberless: boolean // true for Konditirskiy
  is_rezka_output: boolean // true for the single Rezka KN calibre (client Расход "Резка KN" bucket)
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
//
// 2026-09-21 (Phase 2 step 1) -- moved onto React Query, same reasoning as
// useProductTypes.ts. `refetch` is React Query's own, kept in the return
// shape so the Sozlamalar admin screen's existing `await refetch()` calls
// keep working unchanged.
export function useCalibres(includeInactive = false) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.calibres(includeInactive),
    staleTime: MASTER_DATA_STALE_TIME_MS,
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('calibres')
        .select('id, category_id, code, label, is_numberless, is_rezka_output, sort_order, active')
        .order('sort_order')
        .abortSignal(signal)
      if (!includeInactive) query = query.eq('active', true)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as Calibre[]
    },
  })

  return {
    calibres: data ?? [],
    loading: isPending,
    error: error ? error.message : null,
    refetch,
  }
}
