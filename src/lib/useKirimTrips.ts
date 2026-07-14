import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface KirimLine {
  serial: string
  type_id: string
  declared_qty: number
}

export interface KirimOrderRow {
  order_id: string
  order_date: string
  plate: string
  driver: string
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
export function useKirimTrips() {
  const [trips, setTrips] = useState<KirimTrip[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)

    try {
      const [{ data: orders }, { data: lines }, { data: weighings }] = await Promise.all([
        supabase
          .from('kirim_orders')
          .select('order_id, order_date, plate, driver, declared_total, status')
          .order('created_at', { ascending: false }),
        supabase.from('kirim_lines').select('serial, type_id, declared_qty, order_id'),
        supabase
          .from('gate_weighings')
          .select('id, order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'kirim'),
      ])

      const combined: KirimTrip[] = (orders ?? []).map((order) => ({
        order,
        lines: (lines ?? []).filter((l) => l.order_id === order.order_id),
        weighing: (weighings ?? []).find((w) => w.order_id === order.order_id) ?? null,
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
