import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ChiqimLine {
  type_id: string
  calibre_id: string
  qty_kg: number
}

export interface ChiqimRequestRow {
  id: string
  request_date: string
  plate: string
  driver: string
  owner_id: string
  status: string
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
      const [{ data: requests }, { data: lines }, { data: weighings }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          .select('id, request_date, plate, driver, owner_id, status')
          .order('created_at', { ascending: false }),
        supabase.from('chiqim_lines').select('type_id, calibre_id, qty_kg, request_id'),
        supabase
          .from('gate_weighings')
          .select('id, request_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'chiqim'),
      ])

      const combined: ChiqimTrip[] = (requests ?? []).map((request) => ({
        request,
        lines: (lines ?? []).filter((l) => l.request_id === request.id),
        weighing: (weighings ?? []).find((w) => w.request_id === request.id) ?? null,
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
