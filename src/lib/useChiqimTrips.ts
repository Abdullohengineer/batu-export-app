import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

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
}

// Qorovul's CHIQIM tab (SPEC §4) — mirrors useKirimTrips.ts exactly, joining
// chiqim_requests + chiqim_lines + gate_weighings (dir='chiqim', keyed by
// request_id instead of order_id). Same trip shape, same reasoning: the
// gate cares about the request/truck, not any one line on it.
export function useChiqimTrips() {
  const [trips, setTrips] = useState<ChiqimTrip[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)

    try {
      const [{ data: requests }, { data: lines }, { data: weighings }, { data: totals }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          .select('id, request_date, plate, driver, owner_id, status, truck_type')
          .order('created_at', { ascending: false }),
        supabase.from('chiqim_lines').select('type_id, calibre_id, line_kind, qty_kg, request_id'),
        supabase
          .from('gate_weighings')
          .select('id, request_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'chiqim'),
        supabase.from('chiqim_request_totals').select('request_id, loaded_kg'),
      ])

      const loadedByRequest = new Map((totals ?? []).map((t) => [t.request_id, t.loaded_kg]))

      const combined: ChiqimTrip[] = (requests ?? []).map((request) => ({
        request,
        lines: (lines ?? []).filter((l) => l.request_id === request.id),
        weighing: (weighings ?? []).find((w) => w.request_id === request.id) ?? null,
        loadedKg: loadedByRequest.get(request.id) ?? null,
      }))

      setTrips(combined)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { trips, loading, refresh }
}
