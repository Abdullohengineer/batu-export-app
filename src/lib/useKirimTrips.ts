import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'

export interface KirimLine {
  serial: string
  type_id: string
  partiya_no: number | null
  declared_qty: number
}

export interface KirimOrderRow {
  order_id: string
  order_date: string
  plate: string
  driver: string
  owner_id: string
  declared_total: number | null
  status: string
}

export interface GateWeighing {
  id: string
  order_id: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  completed_at: string | null
}

export interface KirimTrip {
  order: KirimOrderRow
  lines: KirimLine[]
  weighing: GateWeighing | null
}

// Qorovul's KIRIM tab (SPEC §4): the gate cares about the trip, not any one
// serial on it — a trip may carry several serials (§2.1), display-only here.
//
// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key).
export function useKirimTrips() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.kirimTrips(),
    queryFn: async ({ signal }): Promise<KirimTrip[]> => {
      const [
        { data: orders, error: ordersErr },
        { data: lines, error: linesErr },
        { data: weighings, error: weighingsErr },
      ] = await Promise.all([
        supabase
          .from('kirim_orders')
          // origin='delivery' only (2026-08-02) — the gate weighs TRUCKS.
          // A seeded opening-stock anchor (origin='opening_stock') or a
          // minted re-processing serial (origin='internal_reprocess') never
          // arrived by road, so it must never appear in Qorovul's queue.
          // Without this filter all 5 seeded old-washed orders showed up as
          // phantom trips awaiting weighing (they carry status='kutilmoqda'
          // and no gate_weighings row, which is exactly this screen's
          // "not started" predicate). A positive allowlist, not an
          // exclusion list, so any future non-delivery origin is covered by
          // construction — same reasoning as report_rows' own filter.
          .select('order_id, order_date, plate, driver, owner_id, declared_total, status')
          .eq('origin', 'delivery')
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        supabase.from('kirim_lines').select('serial, type_id, declared_qty, order_id, partiya_no').abortSignal(signal),
        supabase
          .from('gate_weighings')
          .select('id, order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'kirim')
          .abortSignal(signal),
      ])
      if (ordersErr) throw new Error(ordersErr.message)
      if (linesErr) throw new Error(linesErr.message)
      if (weighingsErr) throw new Error(weighingsErr.message)

      return (orders ?? []).map((order) => ({
        order,
        lines: (lines ?? []).filter((l) => l.order_id === order.order_id),
        weighing: (weighings ?? []).find((w) => w.order_id === order.order_id) ?? null,
      }))
    },
  })

  return {
    trips: data ?? [],
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: error ? error.message : null,
    refresh: refetch,
  }
}
