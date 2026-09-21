import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys, MASTER_DATA_STALE_TIME_MS } from './queryClient'

export interface ProductType {
  id: string
  name: string
  category_id: string // needed to filter calibres to a type's category (§5.3)
  active: boolean
}

// §3.3: default (includeInactive=false) is for NEW-ENTRY dropdowns only.
// Any id->name RESOLUTION for a historical row, or any filter/selection
// dropdown over existing data, must pass includeInactive: true -- see
// useOwners.ts for the full rationale.
//
// 2026-09-21 (Phase 2 step 1) -- moved onto React Query. This hook used to
// silently swallow a failed fetch into `[]` (no `.error` check anywhere),
// which is the confirmed root cause of the "pererabotano renders without
// product type" bug: every `typeName(id)`-style lookup across ~15 screens
// falls back to a dash or a raw id when this list is empty, indistinguishable
// from "this id genuinely has no type." Throwing on `.error` here means
// React Query records a real error instead, and callers that render it (see
// ClientProizvodstvoTab.tsx, HisobotTab.tsx, ClientPanelTab.tsx) show a
// StatusNote banner instead of a wrong-looking blank. `refetch` is now
// React Query's own -- kept in the return shape so every existing call site
// (Sozlamalar's `await refetch()` after a mutation) keeps working unchanged.
export function useProductTypes(includeInactive = false) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.productTypes(includeInactive),
    staleTime: MASTER_DATA_STALE_TIME_MS,
    queryFn: async ({ signal }) => {
      let query = supabase.from('product_types').select('id, name, category_id, active').order('name').abortSignal(signal)
      if (!includeInactive) query = query.eq('active', true)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as ProductType[]
    },
  })

  return {
    productTypes: data ?? [],
    loading: isPending,
    error: error ? error.message : null,
    refetch,
  }
}
