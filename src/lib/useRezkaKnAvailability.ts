import { useQuery } from '@tanstack/react-query'
import { callRpc } from './rpc'
import { queryKeys } from './queryClient'

export interface RezkaKnAvailabilityRow {
  owner_id: string
  type_id: string
  available_kg: number
}

// Konditerka that an Ichki draw can take, per owner + type (SPEC.md §5.R).
// Reads rezka_kn_available(), which sums rezka_kn_candidate_pallets() -- the
// SAME predicate send_kn_to_rezka allocates from (0144), so the tile can
// never show kg the draw would then refuse. Balance/stock read: no origin
// filter (old stock is excluded by is_old_stock inside the predicate).
export function useRezkaKnAvailability() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.rezkaKnAvailability(),
    queryFn: async ({ signal }) => {
      const rows = await callRpc<RezkaKnAvailabilityRow[]>('rezka_kn_available', {}, signal)
      return (rows ?? []).map((r) => ({ ...r, available_kg: Number(r.available_kg) }))
    },
  })
  return { rows: data ?? [], loading: isPending, error, refresh: refetch }
}
