import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys, MASTER_DATA_STALE_TIME_MS } from './queryClient'

// Small master-list lookup, same shape as useOwners/useProductTypes/
// useCalibres — id -> full_name, for resolving actor columns (created_by,
// ombor_finished_by, stage1_created_by, stage2_created_by) to a display
// name. profiles has a read_all policy for every signed-in user (confirmed
// live before building this), so no new RLS is needed.
//
// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key). staleTime matches the other master-data hooks (10 min)
// -- who a profile belongs to changes about as often as owners/product
// types do, not on the business's normal read/write cadence.
export function useProfileNames() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.profileNames(),
    staleTime: MASTER_DATA_STALE_TIME_MS,
    queryFn: async ({ signal }): Promise<Record<string, string>> => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').abortSignal(signal)
      if (error) throw new Error(error.message)
      const map: Record<string, string> = {}
      for (const p of data ?? []) map[p.id] = p.full_name
      return map
    },
  })

  return {
    names: data ?? {},
    loading: isPending,
    error: error ? error.message : null,
  }
}
