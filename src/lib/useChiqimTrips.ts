import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'

export interface ChiqimLine {
  type_id: string
  // Raw dispatch pool rework (2026-08-01): line_kind replaces the old
  // raw_serial-is-not-null marker (see DECISIONS.md "Raw dispatch serial
  // pool") — a raw line now points at a POOL of candidate serials
  // (chiqim_line_raw_serials), not one column here. Neither field is read
  // by name here today (only type_id, via typeName in QorovulChiqimTab.tsx)
  // — widened to keep this type honest about the actual DB shape, not
  // because a consumer branches on it.
  calibre_id: string | null
  line_kind: 'finished' | 'raw'
  qty_kg: number | null
}

export interface ChiqimRequestRow {
  id: string
  request_date: string
  plate: string
  driver: string
  owner_id: string
  status: string
  // 'regular' | 'fura' (2026-08-30, see DECISIONS.md "CHIQIM truck type:
  // Fura"). A fura is never weighed at the gate, so it never enters this
  // tab's Faol window at all — see QorovulChiqimTab.tsx for that split.
  truck_type: string
}

export interface GateWeighing {
  id: string
  request_id: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  completed_at: string | null
}

export interface ChiqimTrip {
  request: ChiqimRequestRow
  lines: ChiqimLine[]
  weighing: GateWeighing | null
  // What Ombor actually loaded on this trip, off the canonical
  // chiqim_request_totals view (migration 0104) — never re-summed here.
  // For a fura this is the ONLY quantity the trip will ever have (there is
  // no gate net); for a regular truck it is what the gate net reconciles
  // against. Null only if the view row is missing, which shouldn't happen.
  loadedKg: number | null
  // Fura gate photos (2026-08-30, see DECISIONS.md "Fura CHIQIM gate
  // photos") — the LATEST capture per kind, off the same view, so this tab
  // and the passport can never disagree about which photo is current.
  // Always null for a regular truck: that one is weighed instead.
  kirdiPhoto: string | null
  chiqdiPhoto: string | null
}

// Qorovul's CHIQIM tab (SPEC §4) — mirrors useKirimTrips.ts exactly, joining
// chiqim_requests + chiqim_lines + gate_weighings (dir='chiqim', keyed by
// request_id instead of order_id). Same trip shape, same reasoning: the
// gate cares about the request/truck, not any one line on it.
//
// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key).
export function useChiqimTrips() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.chiqimTrips(),
    queryFn: async ({ signal }): Promise<ChiqimTrip[]> => {
      const [
        { data: requests, error: requestsErr },
        { data: lines, error: linesErr },
        { data: weighings, error: weighingsErr },
        { data: totals, error: totalsErr },
      ] = await Promise.all([
        supabase
          .from('chiqim_requests')
          .select('id, request_date, plate, driver, owner_id, status, truck_type')
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        supabase.from('chiqim_lines').select('type_id, calibre_id, line_kind, qty_kg, request_id').abortSignal(signal),
        supabase
          .from('gate_weighings')
          .select('id, request_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'chiqim')
          .abortSignal(signal),
        supabase.from('chiqim_request_totals').select('request_id, loaded_kg, kirdi_photo, chiqdi_photo').abortSignal(signal),
      ])
      if (requestsErr) throw new Error(requestsErr.message)
      if (linesErr) throw new Error(linesErr.message)
      if (weighingsErr) throw new Error(weighingsErr.message)
      if (totalsErr) throw new Error(totalsErr.message)

      const totalsByRequest = new Map((totals ?? []).map((t) => [t.request_id, t]))

      return (requests ?? []).map((request) => ({
        request,
        lines: (lines ?? []).filter((l) => l.request_id === request.id),
        weighing: (weighings ?? []).find((w) => w.request_id === request.id) ?? null,
        loadedKg: totalsByRequest.get(request.id)?.loaded_kg ?? null,
        kirdiPhoto: totalsByRequest.get(request.id)?.kirdi_photo ?? null,
        chiqdiPhoto: totalsByRequest.get(request.id)?.chiqdi_photo ?? null,
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
