import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys, MASTER_DATA_STALE_TIME_MS } from './queryClient'

export interface ProductCategory {
  id: string
  name: string
  calibre_applies: boolean
  active: boolean
}

// §3.3 new — no admin screen existed before this task, so no consumer of
// product_categories as a standalone list existed either (product_types/
// calibres reference it only via category_id). Default (includeInactive=
// false) is for assigning a NEW type/calibre to a category; the §3.3
// Sozlamalar screen itself passes includeInactive: true to manage every
// category regardless of status.
//
// 2026-09-21 (Phase 2 step 1) -- moved onto React Query, same reasoning as
// useProductTypes.ts. `refetch` is React Query's own, kept in the return
// shape so the Sozlamalar admin screen's existing `await refetch()` calls
// keep working unchanged.
export function useProductCategories(includeInactive = false) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.productCategories(includeInactive),
    staleTime: MASTER_DATA_STALE_TIME_MS,
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('product_categories')
        .select('id, name, calibre_applies, active')
        .order('name')
        .abortSignal(signal)
      if (!includeInactive) query = query.eq('active', true)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as ProductCategory[]
    },
  })

  return {
    categories: data ?? [],
    loading: isPending,
    error: error ? error.message : null,
    refetch,
  }
}
