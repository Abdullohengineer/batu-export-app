import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys, MASTER_DATA_STALE_TIME_MS } from './queryClient'

export interface Owner {
  id: string
  name: string
  active: boolean
}

// §2.4 OWNERS master data. Default (includeInactive=false) is for NEW-ENTRY
// dropdowns only (KIRIM/CHIQIM forms) -- a deactivated client must still be
// selectable to view/filter their history, and any id->name RESOLUTION for
// a historical row must never drop to a raw uuid just because that owner
// was deactivated after the row was created (§3.3). Pass
// includeInactive: true at any call site doing either of those things.
//
// 2026-09-21 (Phase 2 step 1) -- moved onto React Query, same reasoning as
// useProductTypes.ts (this hook had the identical silent-`[]`-on-error
// bug). `refetch` is React Query's own, kept in the return shape so the
// Sozlamalar/Mijozlar admin screens' existing `await refetch()` calls keep
// working unchanged.
export function useOwners(includeInactive = false) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.owners(includeInactive),
    staleTime: MASTER_DATA_STALE_TIME_MS,
    queryFn: async ({ signal }) => {
      let query = supabase.from('owners').select('id, name, active').order('name').abortSignal(signal)
      if (!includeInactive) query = query.eq('active', true)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as Owner[]
    },
  })

  return {
    owners: data ?? [],
    loading: isPending,
    error: error ? error.message : null,
    refetch,
  }
}
