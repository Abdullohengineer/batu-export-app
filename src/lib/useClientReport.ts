import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
import type { ClientReport } from './clientReport'

// §3.2.7 -- thin client over get_client_report, one RPC round trip returning
// the whole nested document (same shape convention as get_serial_passport).
//
// 2026-09-19 (Phase 1B): moved onto React Query for caching and request
// cancellation. `enabled` reproduces the previous early-return: with no owner
// selected the RPC never fires and the report stays null.
export function useClientReport(ownerId: string | null, from: string, to: string) {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.clientReport(ownerId ?? '', from, to),
    enabled: Boolean(ownerId),
    queryFn: async ({ signal }) => {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_client_report', { p_owner_id: ownerId, p_from: from, p_to: to })
        .abortSignal(signal)
      if (rpcError) throw new Error(rpcError.message)
      return rpcData as ClientReport
    },
  })

  return {
    report: data ?? null,
    // A disabled query (no owner picked) is `pending` in React Query terms,
    // but the old hook reported loading=false there — nothing is in flight.
    loading: Boolean(ownerId) && isPending,
    error: error ? error.message : null,
  }
}
